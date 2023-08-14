const _ = require('lodash');
const AWS = require('aws-sdk');
const s3 = new AWS.S3({apiVersion: '2006-03-01'});
const sqs = new AWS.SQS();
const generatedBucketPath = `${process.env.BUCKET}/generated`;
const uploadBucketPath = `${process.env.BUCKET}/uploads`;
const {executeS3Query, getDataFileSelectList, numberWithCommas} = require('../lib');
const chromium = require('chrome-aws-lambda');
const PDFDocument = require('pdf-lib').PDFDocument
const Mustache = require('mustache');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

const path = require('path');
const fs = require('fs-extra');
const templatePath = path.resolve(`${__dirname}/../template`);
const templateRenderedPath = '/tmp/templates';
let executablePath;

// const momentIncomingReportingPeriodFormat = 'M/D/YY'; // old as of 1/27
const momentIncomingReportingPeriodFormat = 'YYYY-MM-DD';

exports.handler = async (event) => {
    // cleanup from previous runs
    templateRenderCleanup();

    // set up the template files
    setupTemplateRendering();

    // set up the browser and other necessary data
    const browser = await createBrowser();

    const deadletterQueuePush = [];
    await Promise.allSettled(
        _.map(event.Records,  async record => {
            // read the record data and throw an error if not able to read
            const {marshaCode, dataFile, targetFile, leverFile, reportingPeriod} = JSON.parse(record.body)

            // log out some data
            console.log(`====== ${marshaCode} ; Reporting Period: ${reportingPeriod} ====== `);

            // get the report data for the location and the reporting period
            const reportingPeriodMoment = moment(reportingPeriod);
            const reportingPeriodFormatted = reportingPeriodMoment.format(momentIncomingReportingPeriodFormat);
            const locationDataCurrentReportingPeriod = await executeS3Query(
                `SELECT ${getDataFileSelectList()} FROM S3Object s where s."MARSHA" = '${marshaCode}' and s."Reporting.Period" = '${reportingPeriodFormatted}' LIMIT 1`,
                uploadBucketPath, dataFile
            );

            if(locationDataCurrentReportingPeriod.length === 0){
                throw new Error(`There is missing MARSHA data. Cannot generate ${marshaCode} report `);
            }

            // start building the pages and use promise later to await for them to finish;
            // define the pdf Buffers from the result of the page build promises
            // use Promise.all so that if an error is thrown, it will stop processing the marshaCode
            const pdfsBuffersToMerge = await Promise.all([
                buildPageOne(browser, targetFile, marshaCode, reportingPeriod, dataFile, locationDataCurrentReportingPeriod),
                buildPageTwo(browser, targetFile, marshaCode, reportingPeriod, dataFile, leverFile, locationDataCurrentReportingPeriod)
            ]);

            // start merging the PDFs into 1
            const mergedPdf = await PDFDocument.create();
            for (const pdfBytes of pdfsBuffersToMerge) {
                if( pdfBytes === false ) continue;
                const pdf = await PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => {
                    mergedPdf.addPage(page);
                });
            }

            // create the buffer from the Uint8Array mergedPdf.save() result
            const buffer = Buffer.from(
                await mergedPdf.save()
            );

            // try to upload the file
            let uploadResult;
            try{
                uploadResult = await s3.upload({
                    Bucket: `${generatedBucketPath}/${reportingPeriod}`,
                    Key: `${marshaCode}.pdf`,
                    Body: buffer,
                    ContentType: 'application/pdf',
                    //ACL:'public-read'
                }).promise();
            }catch (e) {
                console.error(e)
                // throwing this error will prevent the message from being deleted so we can try to upload it again
                throw new Error(`unable to upload the file ${marshaCode}.pdf`);
            }

            // try to delete the message
            // fail gracefully if the message fails to delete
            try{
                await deleteMessage(record.receiptHandle);
            }catch (e) {
                console.error(e)
            }

            // return the upload result and marsha code for logging pusposes
            return { uploadResult, marshaCode };
        })
    ).then(result => {
        console.log('[BATCHRESULT]', result);

        // record reports that failed.
        _.map(result, (promiseResult, idx) => {
            if(promiseResult.status === 'rejected'){
                const messageBody = JSON.parse(event.Records[idx].body);
                messageBody.error = promiseResult.reason.toString();
                deadletterQueuePush.push(
                  deadletterMessagePush(messageBody)
                )
            }
        })
    });

    // wait for all the failed reports to process
    await Promise.allSettled(deadletterQueuePush)

    // close the browser
    await browser.close();

    // cleanup from this run
    templateRenderCleanup();
};

/**
 * build page 1 of the pdf and return a buffer
 * @param browser
 * @param targetFile
 * @param marshaCode
 * @param reportingPeriod
 * @param dataFile
 * @param locationDataCurrentReportingPeriod
 * @return {Promise<Buffer>}
 */
const buildPageOne = async (browser, targetFile, marshaCode, reportingPeriod, dataFile, locationDataCurrentReportingPeriod) => {
    // create a page for output
    const page = await createPage(browser);

    // get the location data just in case there is no data in the below query
    const reportingPeriodMoment = moment(reportingPeriod);

    // get the location data and location target data using s3 select
    const [
        locationData,
        locationTargetData,
        euiDistributionData
    ] = await Promise.all([
        executeS3Query(
            `SELECT ${getDataFileSelectList()} FROM S3Object s where s."MARSHA" = '${marshaCode}' and s."VAL.E" = 'TRUE'`,
            uploadBucketPath, dataFile
        ),
        executeS3Query(
            `SELECT CAST(s."Emissions Reduction by 2030" AS FLOAT) as emissionReductionTargetBy2030, CAST(s."Annual EUI Target" AS FLOAT) as AnnualEUITarget FROM S3Object s where s."MARSHA" = '${marshaCode}' LIMIT 1`,
            uploadBucketPath, targetFile
        ),
        getEuiDistributionData(marshaCode, dataFile, targetFile, reportingPeriod)
    ]);

    // set base template data
    const templateData = {
        location: {
            name: locationDataCurrentReportingPeriod[0].Property,
            marsha: marshaCode
        },
        totalCarbon: {
            reduction: 'n/a',
            baseline: 'n/a'
        },
        euiReduction: 'n/a',
        euiBaseline: 'n/a',
        currentReportYear: reportingPeriodMoment.format('YYYY'),
        reportingDate: reportingPeriodMoment.format('MMMM Do, YYYY')
    };

    if(locationData.length === 0){
        throw new Error(`MARSHA location data is not validated (VAL.E = false). Cannot generate ${marshaCode} report `);
    }

    if(locationTargetData.length === 0){
        throw new Error(`There is missing location 2030 target data.  Cannot generate ${marshaCode} report `);
    }

    // 2019 Carbon baseline and target
    const emissionReductionTargetBy2030 = locationTargetData[0].emissionReductionTargetBy2030;
    const carbonBaseline = locationData[0].CARBON;
    const emissionTargetBy2030 = parseInt(carbonBaseline) - parseInt(emissionReductionTargetBy2030);
    const euiTableData = [];
    let lastIdx = 0, euiIn2019 = 0, totalCarbonIn2019 = 0;

    if(locationData.length > 0){
        // generate the page data for the template
        // start by sorting the location data by date

        locationData.sort((a, b) => new Date(a.ReportingPeriodFormatted) - new Date(b.ReportingPeriodFormatted));

        // start the table data array for the carbon table
        lastIdx = (locationData.length - 1);
        const twelveMonthsAgo = reportingPeriodMoment.clone().subtract(12, 'months');
        locationData.forEach((dataRow, idx) => {
            let euiLabel = null,
                thisReportReportingPeriod = moment(dataRow.ReportingPeriodFormatted);

            // build a year month and day for use later in this logic
            const month = thisReportReportingPeriod.format('M')-1;
            const day = thisReportReportingPeriod.format('D');
            const year = thisReportReportingPeriod.format('YYYY');

            // todo: this will be changed in the future
            // to get the EUI Target, for this first release, we need to take the 2019 eui value
            // and subtract it from the goal percent.  first lets capture the number
            if(euiIn2019 === 0 && year === '2019'){
                euiIn2019 = parseInt(dataRow.EUI);
                totalCarbonIn2019 = parseInt(dataRow.CARBON);
                templateData.euiBaseline = euiIn2019;
            }


            // we only want to show the last 12 months.
            const loopReportDate = moment(`${year}-${month+1}-${day}`, "YYYY-M-D");
            if(loopReportDate >= twelveMonthsAgo && loopReportDate <= reportingPeriodMoment) {
                if(euiTableData.length === 0 || idx === lastIdx){
                    euiLabel = numberWithCommas(parseInt(dataRow.EUI));
                }
                euiTableData.push([
                    `Date(${year}, ${month}, ${day})`,
                    parseInt(dataRow.EUI),
                    euiLabel
                ]);
            }
        });

        if((new Date(locationData[0].ReportingPeriodFormatted)).getFullYear() === 2019){
            templateData.totalCarbon.reduction = numberWithCommas(emissionTargetBy2030);
            templateData.totalCarbon.baseline = numberWithCommas(parseInt(carbonBaseline));
        }
    }


    // Your properties current EUI reduction Target
    const rawEuiTarget = locationTargetData[0].AnnualEUITarget.toFixed(2);
    const intEuiReductionPercent = parseFloat(rawEuiTarget * 100).toFixed(2);
    templateData.euiReduction = intEuiReductionPercent.toString() + '%';
    if(euiIn2019 > 0){
        const percentValueToSubtract = (euiIn2019 * rawEuiTarget);
        const euiTarget = parseInt(euiIn2019 - percentValueToSubtract);
    }

    // render the page using the template data
    const renderedFile = renderTemplate(`${templatePath}/page1.html`, templateData);

    // render the page to the PDF using the renderedFile template
    // and set the page orientation to landscape
    await page.goto(`file://${renderedFile}`, {waitUntil: 'load'});
    page.addStyleTag( {'content': '@page { size: A4 landscape; }'} );

    // add the charts to the page using the page.evaluate() method
    const carbonStart = parseInt(locationDataCurrentReportingPeriod[0].CARBON);
    const carbonTarget = parseInt(emissionReductionTargetBy2030)
    const reportingPeriodYear = reportingPeriodMoment.format('YYYY');
    page.evaluate((euiTableData, euiDistributionData, marshaCode, carbonStart, carbonTarget, reportingPeriodYear, totalCarbonIn2019) => {
        drawEuiTable(euiTableData, '.euiTableWrap .chart');
        drawHistogram(euiDistributionData, '.myEnergy .chart', marshaCode);
        drawCandlestickChart(reportingPeriodYear, totalCarbonIn2019, carbonStart, carbonTarget, '.carbonReduction .chart');
    }, euiTableData, euiDistributionData, marshaCode, carbonStart, carbonTarget, reportingPeriodYear, totalCarbonIn2019);

    // wait for the pages to render
    await page.waitForTimeout(500);

    // create the PDF buffer
    const buffer = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: {
            top   : 0, right : 0,
            bottom: 0, left  : 0
        }
    });

    // close the browser
    await page.close();

    // delete the rendered file to keep aws space clean
    await deleteRenderedTemplate(renderedFile);

    // return the buffer to build the pdfs
    return buffer;
};

/**
 * build page 2 of the pdf and return a buffer
 * @param browser
 * @param targetFile
 * @param marshaCode
 * @param reportingPeriod
 * @param dataFile
 * @param leverFile
 * @param locationDataCurrentReportingPeriod
 * @return {Promise<Buffer>}
 */
const buildPageTwo = async (browser, targetFile, marshaCode, reportingPeriod, dataFile, leverFile, locationDataCurrentReportingPeriod) => {

    // start page 2 by fetching the data abd creating the browser
    // promise.all will fail if any of the functions fail
    const [
        leverData, page
    ] = await Promise.all([
        fetchLeverData(leverFile, marshaCode),
        createPage(browser)
    ]);

    // render the template with the correct template data
    const renderedFile = renderTemplate(`${templatePath}/page2.html`, {
        location: {
            name: locationDataCurrentReportingPeriod[0].Property,
            marsha: marshaCode
        },
        reportingDate:  moment(reportingPeriod).format('MMMM Do, YYYY')
    });

    // render the template and set the page orientation to landscape
    await page.goto(`file://${renderedFile}`);
    page.addStyleTag( {'content': '@page { size: A4 landscape; }'} );

    // build the lever table at the bottom of the page
    page.evaluate(buildLeverTable, leverData);

    // wait for the chart to render
    await page.waitForTimeout(500);

    // create the PDF buffer
    const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
            top   : 0, right : 0,
            bottom: 0, left  : 0
        }
    });

    // close the browser
    await page.close();

    // return the pdf buffer to write
    return buffer;
};

/**
 * delete the SQS message
 * @param receiptHandle
 * @return {*}
 */
const deleteMessage = receiptHandle => {
    return sqs.deleteMessage({
        QueueUrl: process.env.SQS,
        ReceiptHandle: receiptHandle
    }).promise();
};

const deadletterMessagePush = message => {
    return sqs.sendMessage({
        MessageBody: JSON.stringify(message),
        QueueUrl: process.env.DEADLETTER
    }).promise();
};

/**
 * render the template to the local filesystem using the data provided
 * @todo move the generated files over to s3 and delete after their use. -- this may help with files being deleted before they're used
 * @param file
 * @param data
 * @return {string}
 */
const renderTemplate = (file, data) => {
    // read the file that we're trying to template
    let fileData = '';
    try {
        fileData = fs.readFileSync(file, 'utf8');
    } catch (err) {
        console.error(err);
        throw new Error(`Unable to read web file template ${file}`);
    }

    // render the mustache file
    const renderedData =  Mustache.render(fileData, data);

    // render the output file
    const resultFile = `${templateRenderedPath}/${uuidv4()}-${data.location.marsha}.html`;

    try {
        fs.writeFileSync(resultFile, renderedData);
    } catch (err) {
        console.error(err);
        throw new Error(`Unable to write web template file ${file}`);
    }

    return resultFile;
};

/**
 * delete the template file
 * @param template
 * @return {<promise>}
 */
const deleteRenderedTemplate = template => {
    return fs.unlink(template);
};

/**
 * setup the templates for render by copying the
 * template directory to the /tmp directory of the Lambda
 * @todo move the generated files over to s3 and delete after their use. -- this may help with files being deleted before they're used
 */
const setupTemplateRendering = () => {
    try {
        fs.copySync(templatePath, templateRenderedPath, {overwrite: true});
    } catch (err) {
        console.error(err);
        throw new Error(`Unable to copy the template directory into a test environment`);
    }
};

/**
 * delete the templates generated by this file run
 */
const templateRenderCleanup = () => {
    try {
        fs.rmdirSync(templatePath, { recursive: true })
    } catch (err) {
        console.error(err);
        throw new Error(`Unable to cleanup the template directory.`);
    }
};

/**
 * fetch the Level data using S3 Select and sort it accordingly
 * @param leverFile
 * @param marshaCode
 * @return {Promise<[]>}
 */
const fetchLeverData = async (leverFile, marshaCode) => {
    // read the LEVER data
    const s3LevelData = await executeS3Query(
        `SELECT * FROM S3Object s where s."MARSHA" = '${marshaCode}'`,
        uploadBucketPath, leverFile
    );

    // sort by lever string (short, med, long, to be calculated)
    s3LevelData.sort((a, b) => {
        const aVal = a['Simple Payback'].replace(/[^A-Za-z]/g, '');
        const bVal = b['Simple Payback'].replace(/[^A-Za-z]/g, '');
        // these if statements were taken from ChatGTP
        if (aVal === "Short") return -1;
        if (bVal === "Short") return 1;
        if (aVal === "Medium") return -1;
        if (bVal === "Medium") return 1;
        if (aVal === "Long") return -1;
        if (bVal === "Long") return 1;
        if (aVal === "Tobecalculated") return -1;
        if (bVal === "Tobecalculated") return 1;
        return 0;
    });

    // some strings have numbers, so let's re-sort looking at those columns
    s3LevelData.sort((a, b) => {
        const aStringVal = a['Simple Payback'].replace(/[^A-Za-z]/g, '');
        const bStringVal = b['Simple Payback'].replace(/[^A-Za-z]/g, '');
        const aFloatVal = parseFloat(a['Simple Payback'].replace(/[A-Za-z\s()]/g, ''));
        const bFloatVal = parseFloat(b['Simple Payback'].replace(/[A-Za-z\s()]/g, ''));
        if(aStringVal === bStringVal && !isNaN(aFloatVal) && !isNaN(bFloatVal)){
            return aFloatVal - bFloatVal;
        }
        return 0;
    });

    // return the fetched data
    return s3LevelData;
};

/**
 * create a puppeteer browser instance
 * @return {Promise<Browser>}
 */
const createBrowser = async () => {
    if(!executablePath){
        executablePath = await chromium.executablePath;
    }
    return chromium.puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: executablePath,
        headless: chromium.headless
    });
};

/**
 * create the page from a browser
 * @param browser
 * @return {Promise<*>}
 */
const createPage = async (browser) => {
    const page = await browser.newPage();
    // page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    return page;
};

/**
 * Get the EUI Distribution data through
 * Note that if changes occur to the column names, we'll need to update the validate methods
 * @param marshaCode
 * @param dataFile
 * @param targetFile
 * @param reportingPeriod
 * @return {Promise<*[]|*>}
 */
const getEuiDistributionData = async (marshaCode, dataFile, targetFile, reportingPeriod) => {
    // fetch peer group for the MARSHA location
    const peerGroup = await executeS3Query(
        `SELECT s."Peer Group" as PeerGroup FROM S3Object s where s."MARSHA" = '${marshaCode}'`,
        uploadBucketPath, targetFile
    );

    // using the peer group, fetch the marsha codes within the same group
    if(peerGroup.length > 0){
        const peerGroupName = peerGroup[0].PeerGroup;
        const MarshaCodes = await executeS3Query(
            `SELECT s.MARSHA FROM S3Object s where s."Peer Group" = '${peerGroupName}'`,
            uploadBucketPath, targetFile
        );

        // using the marsha codes, fetch the EUI values for this reporting period
        if(MarshaCodes.length > 0){
            // create an array of codes
            const marshaCodeList = MarshaCodes.reduce((collector, item) => { collector.push(item.MARSHA); return collector; }, [])

            // get the current reporting period
            const fileFormattedDate = moment(reportingPeriod).format(momentIncomingReportingPeriodFormat);

            // run the query
            const SelectList = [
                's."MARSHA"', 'CAST(s."EUI" AS FLOAT) as "EUI"',
                `CAST(CAST(s."CARBON" AS FLOAT)/CAST(s."Rms" AS INT) AS INT) as carbonByRooms`
            ].join(', ')
            const AndList = [
                `s."MARSHA" IN ('${marshaCodeList.join("','")}')`,
                `s."Reporting.Period" = '${fileFormattedDate}'`,
                `s."VAL.E" = 'TRUE'`
            ].join(' AND ');
            const EUINumbers = await executeS3Query(
                `SELECT ${SelectList} FROM S3Object s where ${AndList} `,
                uploadBucketPath, dataFile
            );

            // format these values for google graphs to use
            return EUINumbers.reduce((collector, item) => {
                collector.push([
                    item.MARSHA,
                    item.carbonByRooms
                ]);
                return collector;
            }, [['Marsha', 'EUI']]);
        }
    }

    // return an empty array if there is no data
    return [];
};

/**
 * build the lever table for page 2.
 * the context of this function is inside a web browser where `document` is available.
 * @param leverData
 */
const buildLeverTable = (leverData) => {
    let table = document.querySelector('.leverLibrary table.leverData');

    const header = [
        'Name',
        'Energy Savings %',
        'Cost Savings - Clean',
        'Implementation Cost - Clean',
        'Simple Payback'
    ];

    const leverTableHeaderName = str => {
        switch(str){
            case 'Simple Payback':
                return `${str} (years)`;
            case 'Energy Savings %':
                return 'Energy Savings (%)';
            case 'Cost Savings - Clean':
                return 'Cost Savings (USD)';
            case 'Implementation Cost - Clean':
                return 'Implementation Cost (USD)';
        }
        return str;
    }

    // add the headers
    let tr = document.createElement('tr');
    header.forEach(head => {
        const th = document.createElement('th');
        //th.innerHTML = head;
        th.innerHTML = leverTableHeaderName(head);
        tr.append(th);
    });
    table.append(tr);

    for (let i = 0; i<leverData.length; i++) {
        let tr = document.createElement('tr');
        if(i % 2 === 0) {
            tr.classList.add('colorize');
        }
        // add the table data
        header.forEach(col => {
            let td = document.createElement('td');
            let value = leverData[i][col];
            if(['Cost Savings - Clean', 'Implementation Cost - Clean', 'Simple Payback'].includes(col)){
                // clean up the string by removing the \t character, and spaces
                value = value.replace('[^\$0-9\.,]+', '');
            }
            td.innerHTML = value;
            tr.append(td)
        });
        table.append(tr);
    }
};



