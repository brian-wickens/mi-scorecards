const _ = require("lodash");
const AWS = require('aws-sdk');
const s3 = new AWS.S3({apiVersion: '2006-03-01'});

const executeS3Query = async (query, bucket, file, hasHeader = true) => {
    const s3QueryParams = {
        Bucket: bucket,
        Key: file,
        ExpressionType: 'SQL',
        Expression: query,
        InputSerialization: { CSV: { FileHeaderInfo: 'USE', RecordDelimiter: '\r\n', FieldDelimiter: ',' } },
        OutputSerialization: { JSON: { RecordDelimiter: ',' } }
    };

    if(!hasHeader){
        s3QueryParams.InputSerialization.CSV.FileHeaderInfo = 'NONE';
        //_.unset(s3QueryParams.OutputSerialization, 'JSON');
        //s3QueryParams.OutputSerialization.CSV = {};
    }

    let queryResult;
    try{
        queryResult = await s3.selectObjectContent(s3QueryParams).promise();
    }catch (e) {
        console.error({query, bucket, file});
        if(e.code === 'InvalidTextEncoding'){
            throw new Error(`The file '${file}' is expected to be a UTF8 CSV file.  Please re-encode the file and re-upload the file.`)
        }
        if(e.code === 'NoSuchKey'){
            throw new Error(`The file '${file}' doesn't exist.`)
        }
        throw e;
    }

    let strData = '';
    return new Promise((accept, reject) => {
        queryResult.Payload.on('data', data => {
            // don't process if we don't have any results
            if(!_.has(data.Records, "Payload") || _.isNil(data.Records, "Payload")) return;

            // get the data buffer and turn it into an array
            strData += Buffer.from(data.Records.Payload).toString();
        }).on('error', e => {
            console.error({query, bucket, file});
            throw e;
            //reject( e.getMessage );
        }).on('end', async () => {
            accept(
                JSON.parse(`[${strData.slice(0,-1)}]`)
            );
        })
    });
};

const getDataFileSelectList = (asArray) => {
    //return "*";
    const columnList = [
        `s."MARSHA"`,
        `s."CARBON.FUEL" as CarbonFuel`,
        `s."CARBON"`,
        //`s."CARBON.NONFUEL" as CarbonNonfuel`,
        //`s."CARBON.ELEC" as CarbonElec`,
        `s."EUI" as EUI`,
        `s."Property"`,
        `s."Reporting.Period" as ReportingPeriod`,
        `TO_TIMESTAMP(s."Reporting.Period") as ReportingPeriodFormatted`,
        //`TO_TIMESTAMP(s."Reporting.Period", 'M/d/yy') as ReportingPeriodFormatted`
    ];

    if(asArray){
        return columnList;
    }
    return columnList.join(', ')
};

const numberWithCommas = x => {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

module.exports = {executeS3Query, getDataFileSelectList, numberWithCommas};
