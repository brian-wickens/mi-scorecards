# marriott

Marriott specific execution information is located in this document below the [Resources](#resources) heading

This project contains source code and supporting files for a serverless application that you can deploy with the SAM CLI. It includes the following files and folders.

- src - Code for the application's Lambda function.
- events - Invocation events that you can use to invoke the function.
- src/tests - Unit tests for the application code. (coming soon)
- template.yaml - A template that defines the application's AWS resources.

The application uses several AWS resources, including Lambda functions and an SQS. These resources are defined in the `template.yaml` file in this project. You can update the template to add AWS resources through the same deployment process that updates your application code.

If you prefer to use an integrated development environment (IDE) to build and test your application, you can use the AWS Toolkit.  
The AWS Toolkit is an open source plug-in for popular IDEs that uses the SAM CLI to build and deploy serverless applications on AWS. The AWS Toolkit also adds a simplified step-through debugging experience for Lambda function code. See the following links to get started.

* [CLion](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [GoLand](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [IntelliJ](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [WebStorm](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [Rider](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [PhpStorm](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [PyCharm](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [RubyMine](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [DataGrip](https://docs.aws.amazon.com/toolkit-for-jetbrains/latest/userguide/welcome.html)
* [VS Code](https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/welcome.html)
* [Visual Studio](https://docs.aws.amazon.com/toolkit-for-visual-studio/latest/user-guide/welcome.html)

## Deploy the mariott application

The Serverless Application Model Command Line Interface (SAM CLI) is an extension of the AWS CLI that adds functionality for building and testing Lambda applications. It uses Docker to run your functions in an Amazon Linux environment that matches Lambda. It can also emulate your application's build environment and API.

To use the SAM CLI, you need the following tools.

* SAM CLI - [Install the SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
* Node.js - [Install Node.js 16](https://nodejs.org/en/), including the NPM package management tool.
* Docker - [Install Docker community edition](https://hub.docker.com/search/?type=edition&offering=community)

To build and deploy your application for the first time, run the following in your shell:

```bash
sam build
sam deploy --guided
```

The first command will build the source of your application. The second command will package and deploy your application to AWS, with a series of prompts:

* **Stack Name**: The name of the stack to deploy to CloudFormation. This should be unique to your account and region, and a good starting point would be something matching your project name.
* **AWS Region**: The AWS region you want to deploy your app to.
* **Confirm changes before deploy**: If set to yes, any change sets will be shown to you before execution for manual review. If set to no, the AWS SAM CLI will automatically deploy application changes.
* **Allow SAM CLI IAM role creation**: Many AWS SAM templates, including this example, create AWS IAM roles required for the AWS Lambda function(s) included to access AWS services. By default, these are scoped down to minimum required permissions. To deploy an AWS CloudFormation stack which creates or modifies IAM roles, the `CAPABILITY_IAM` value for `capabilities` must be provided. If permission isn't provided through this prompt, to deploy this example you must explicitly pass `--capabilities CAPABILITY_IAM` to the `sam deploy` command.
* **Save arguments to samconfig.toml**: If set to yes, your choices will be saved to a configuration file inside the project, so that in the future you can just re-run `sam deploy` without parameters to deploy changes to your application.

## Use the SAM CLI to build and test locally

Build your application with the `sam build` command.

```bash
marriott$ sam build
```

The SAM CLI installs dependencies defined in `package.json`, creates a deployment package, and saves it in the `.aws-sam/build` folder.

Test a single function by invoking it directly with a test event. An event is a JSON document that represents the input that the function receives from the event source. Test events are included in the `events` folder in this project.

Run functions locally and invoke them with the `sam local invoke` command.

```bash
marriott$ sam local invoke SQSService --event events/event.json
```

## Add a resource to your application
The application template uses AWS Serverless Application Model (AWS SAM) to define application resources. AWS SAM is an extension of AWS CloudFormation with a simpler syntax for configuring common serverless application resources such as functions, triggers, and APIs. For resources not included in [the SAM specification](https://github.com/awslabs/serverless-application-model/blob/master/versions/2016-10-31.md), you can use standard [AWS CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html) resource types.

## Fetch, tail, and filter Lambda function logs

To simplify troubleshooting, SAM CLI has a command called `sam logs`. `sam logs` lets you fetch logs generated by your deployed Lambda function from the command line. In addition to printing the logs on the terminal, this command has several nifty features to help you quickly find the bug.

`NOTE`: This command works for all AWS Lambda functions; not just the ones you deploy using SAM.

```bash
marriott$ sam logs -n SQSService --stack-name marriott --tail
```

You can find more information and examples about filtering Lambda function logs in the [SAM CLI Documentation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-logging.html).

## Unit tests

Tests are defined in the `src/tests` folder in this project. Use NPM to install the [Mocha test framework](https://mochajs.org/) and run unit tests.

```bash
$ cd mariott
mariott$ npm install
mariott$ npm run test
```

## Cleanup

To delete the mariott application that you created, use the AWS CLI. Assuming you used your project name for the stack name, you can run the following:

```bash
aws cloudformation delete-stack --stack-name marriott
```

## Resources

See the [AWS SAM developer guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html) for an introduction to SAM specification, the SAM CLI, and serverless application concepts.

Next, you can use AWS Serverless Application Repository to deploy ready to use Apps that go beyond hello world samples and learn how authors developed their applications: [AWS Serverless Application Repository main page](https://aws.amazon.com/serverless/serverlessrepo/)

# Marriott Specific Execution

## Application Background

The underlying goal was to write a scalable application that will take certian JSON and CSV data input and generate >8000 PDF files to be distributed to different locations on demand.

The tools that were used were as follows:

* Lambda
* S3 and S3 Select
* Simple Queueing Service (x2)

There are 2 lambda functions that exist within this application:

### PopulateQueue

A function to ingest the initial dataset which is a JSON payload of the following data:

  * `dataFile` - This is the name of the csv datafile uploaded to the `s3://uploads` directory
  * `marshaCodes` - This is the name of the csv file listing the MARSHA codes this execution should run for 
  * `targetFile` - This is the name of the csv file containing the marsha target data
  * `leverFile` - This is the csv file containing the lever data for each property
  * `reportingPeriod` - This is the date that the report should be generated for in the format of `YYYY-MM-DD`

an example of this json payload can be seen here:

```json
{
  "dataFile": "validation_combined.csv",
  "marshaCodes": "scorecard_MARSHA.csv",
  "targetFile": "Targets - M_F Same-Table 1.csv",
  "leverFile": "Levers_Clean-Table 1.csv",
  "reportingPeriod": "2022-06-30"
}
```

Once this data is ingested, it will create a record within the SQS for every file to be generated

### SqsMessage

Executing automatically by the SQS queue, this function accepts 10 messages from the queue, with it's secific marsha code and additional file and reporting period data from the `PopulateQueue` function execution.

The JSON payload for this function consists of an array of 10 items of the following data:

* `marshaCode` - Specific code for a file to be generated
* `dataFile` - This is the name of the csv datafile uploaded to the `s3://uploads` directory (passed directly from `PopulateQueue`)
* `targetFile` - This is the name of the csv file containing the marsha target data (passed directly from `PopulateQueue`)
* `leverFile` - This is the csv file containing the lever data for each property (passed directly from `PopulateQueue`)
* `reportingPeriod` - This is the date that the report should be generated for in the format of `YYYY-MM-DD` (passed directly from `PopulateQueue`)

an example of this json payload can be seen here:

```json
{
  "marshaCode": "ALBWA",
  "dataFile": "validation_combined.csv",
  "targetFile": "Targets - M_F Same-Table 1.csv",
  "leverFile": "Levers_Clean-Table 1.csv",
  "reportingPeriod": "2022-06-30"
}
```

## File Formatting

**ALL** files that are part of this application are required be a `utf8` formatted document.

Additionally, **ALL** files require a header EXCEPT the `marshaCodes` file, which specifies what PDFs will be generated.

If the `marshaCodes` file were to have a header, the header text would be expected to be marsha code and would attempt to generate the necessary PDF.

## File Location

Files used to execute lambda functions should be stored in the `s3://uploads` directory within the bucket created from within the CloudFormation template.

## Execution

Execution can happen 1 of 2 ways:

### Execute via Commandline

Invoking a function within AWS can be done via the local command line.  

To invoke a function remotely, use the below command:

```bash
aws lambda invoke --function-name PopulateQueue --payload '{ "dataFile": "validation_combined.csv", "marshaCodes": "scorecard_MARSHA.csv", "targetFile": "Targets - M_F Same-Table 1.csv", "leverFile": "Levers_Clean-Table 1.csv", "reportingPeriod": "2022-06-30" }' out --log-type Tail
```

where the function name `PopulateQueue` is the function created by the cloudformation stack: it will NOT be just `PopulateQueue`.

### Execution via AWS Console

Invocation can happen from the AWS console as well, which may be easier.  

To execute the initial finction from the console, follow these steps:

1. open the aws console by navigating to https://console.aws.amazon.com
2. navigate to the cloudformation created `PopulateQueue` function
3. click the "test" tab
4. if this is you first time executing this function, for `Test event action`, select `Create new event`
5. name your event
6. paste the JSON object into the `Event JSON` field.
7. click the orange `Test` function

Once either of these methods are executed, the `pdfqueue` SQS queue should start to populate, and shortly after, PDF files should start to appear in the `s3://generaged/<reportdate>/` directory.

If files don't begin to populate, debugging will have to start.

## Deadletter SQS Queue

If the `pdfqueue` populates, yet is unable to process files or there are other general errors, the messages will fall over ino the `pdfqueue-deadletter` queue.

This queue is designed to hold messages that wern't processed so the application can be fixed to re-run these messages.

If this queue is populated, then debugging for errors will have to begin.

## Notes

The only file that should be executed is the `PopulateQueue` function.  

this function will generate the necessary items to build all the PDF files that are listed within the the `marshaCode` file. 

## Potential improvements

1. Have the file automatically sent to the Marriott location.
2. Update to state function to automatically send summary email about failed reports, and when reports have completed generating
