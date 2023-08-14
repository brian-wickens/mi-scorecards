const _ = require('lodash');
const AWS = require('aws-sdk');
const sqs = new AWS.SQS();
const s3 = new AWS.S3({apiVersion: '2006-03-01'});
const missingParametsers = [];
const reqParameters = [ 'dataFile', 'targetFile', 'marshaCodes', 'leverFile' ];
const bucket = `${process.env.BUCKET}/uploads`;
const {executeS3Query, getDataFileSelectList} = require('../lib');
const todaysDate = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '').split(' ')[0];


exports.handler = async (event, context) => {

    // Verity that the data is intact
    console.time('verifyEventData');
    verifyEventData(event);
    console.timeEnd('verifyEventData');

    // verify that the files exist
    console.time('verifyFiles');
    await verifyFiles(event);
    console.timeEnd('verifyFiles');

    // get Marsha Codes
    console.time('getMarshaCodes');
    const marshaCodes = await executeS3Query(
        `SELECT * FROM S3Object s`,
        bucket, event.marshaCodes, false
    );
    console.timeEnd('getMarshaCodes');

    console.log(marshaCodes.length);

    // const test = await fetchMarshaCode('AANLO', bucket, event.dataFile);
    // console.log(test);
    // return;

    console.time('marshaCodesForeach');
    let batchAry = [], messageBatchAry = [], dataAry = [];
    marshaCodes.forEach(codeObj => {
        const marshaCode = codeObj['_1'].trim();
        if(!marshaCode){
            console.log('missing:', marshaCode)
            return;
        }

        dataAry.push({
            Id: marshaCode,
            MessageBody: JSON.stringify({
                marshaCode: marshaCode,
                dataFile: event.dataFile,
                leverFile: event.leverFile,
                reportingPeriod: event.reportingPeriod,
                targetFile: event.targetFile
            })
        });

        if(dataAry.length === 10){
            console.log(dataAry);
            messageBatchAry.push(
                sendSqsPayloads(dataAry)
            );
            dataAry = [];
        }
    });
    if(dataAry.length > 0){
        messageBatchAry.push(
            sendSqsPayloads(dataAry)
        );
    }
    console.timeEnd('marshaCodesForeach');

    // wait until all the messages are sent
    await Promise.allSettled(messageBatchAry)
    return;


    // batch the sqs payload generation which will query for the compare file
    // and once the payload generation is complete, we'll send the sqs payloads
    // let batchAry = [], messageBatchAry = [], dataAry = [];
    // _.forOwn(s3Data, async (row) => {
    //     dataAry.push({
    //         Id: row.MARSHA,
    //         MessageBody: JSON.stringify({
    //             current: row,
    //             compareFile: event.compare
    //         })
    //     });
    //     if(dataAry.length === 10){
    //         messageBatchAry.push(
    //             sendSqsPayloads(dataAry)
    //         );
    //         dataAry = [];
    //     }
    // });

    // if we didn't hit 10, we need to make sure that we add all the locations
    if(dataAry.length > 0) {
        messageBatchAry.push(
            sendSqsPayloads(dataAry)
        );
    }

    // wait for the batch ary to finish, and then we're done.
    await Promise.allSettled(messageBatchAry)
        .then(console.log);
};

/**
 * fetch the data for the specific marsha code
 * @param marshaCode
 * @param bucket
 * @param dataFile
 * @return {Promise<unknown>}
 */
const fetchMarshaCode = (marshaCode, bucket, dataFile) => {
    // query for VAL.E = true and OT = M
    //const query = `SELECT ${getDataFileSelectList()} FROM S3Object s where s."VAL.E" = 'TRUE' and s."OT" = 'M'`;
    const query = `SELECT ${getDataFileSelectList()} FROM S3Object s where s."MARSHA" = '${marshaCode}'`;
    return executeS3Query(
        query, bucket, dataFile
    );
};

const pushFetchedDataToSqs = async fetchedData => {
    console.log('pushFetchedDataToSqs', fetchedData)
};

const sendSqsPayloads = async (dataAry) => {
    return sqs.sendMessageBatch({
        Entries: dataAry,
        QueueUrl: process.env.SQS
    }).promise();
}

const verifyEventData = event => {
    _.forOwn(reqParameters, param => {
        if(!_.has(event, param) && !_.isEmpty(event[param])){
            missingParametsers.push(param);
        }
    });

    if(missingParametsers.length > 0){
        throw new Error(`Missing required parameter${missingParametsers.length > 1 ? 's' : ''}: ${missingParametsers.join(', ')}`)
    }
};

const verifyFiles = async event => {
    await Promise.all(
        // for each of the files, let's determine of they're there, and return a read stream
        _.map(reqParameters, async file => {
            const fileParams = { Bucket: bucket, Key: event[file] };
            try{
                // determine if the file exists
                // this will trigger an error that we can catch and re-throw with a user-friendly error
                await s3.headObject(fileParams).promise();
                //return s3.getObject(fileParams).createReadStream();
            }catch (e) {
                throw new Error(`Expected file 's3://${bucket}/${event[file]}' does not exist.`);
            }
        })
    );
};
