"use strict";

const util = require('util');
const AWS = require("aws-sdk");
/**
 * Deploy env
 * @param event
 * @param context
 * @param callback
 * Example of params
 {
   "region": "eu-central-1",
   "applicationName": "Demo",
   "environmentName": "demo-prod",
   "versionRegex": "demo_prod"
 }
 */
module.exports.deploy = (event, context, callback) => {

    console.log("EVENT", inspect(event));
    console.log("CONTEXT", inspect(context));

    let pipeLineRegion = process.env.AWS_REGION;
    let PIPE_LINE = new AWS.CodePipeline({
        region: pipeLineRegion
    });
    let job = event["CodePipeline.job"];
    let config = job.data.actionConfiguration.configuration;
    let params;

    try {
        params = JSON.parse(config.UserParameters);
    } catch (e) {
        let parsingError = new Error("Error parsing json");
        return wrap(
            PIPE_LINE.putJobFailureResult.bind(PIPE_LINE),
            {
                jobId: job.id,
                failureDetails: {
                    type: "JobFailed",
                    message: parsingError.toString()
                }
            }
        ).then(data => {
            console.log("NOTIFY-PIPE-LINE-ERROR-RESULT", inspect(data));
            return callback(parsingError);
        });
    }

    console.log("PIPELINE-REGION", pipeLineRegion);

    let ApplicationName = params.applicationName;
    let EnvironmentName = params.environmentName;
    let PROD_ENV = new RegExp(params.versionRegex);
    let EBS = new AWS.ElasticBeanstalk({
        region: params.region
    });

    console.log("PARAMS", params, params.region);

    wrap(
        EBS.describeApplicationVersions.bind(EBS),
        {
            ApplicationName: ApplicationName
        }
    )
        .then(data => {
            console.log("VERSIONS", inspect(data));
            let filtered = data.ApplicationVersions.filter(item => PROD_ENV.test(item.VersionLabel));
            let item = filtered.shift();
            console.log("VERSION", inspect(item));
            if (item && item.Status && item.Status.toLocaleLowerCase() != "processed") {
                return item;
            } else if (!!item) {
                throw new Error("Version is already deployed: " + item.VersionLabel);
            }
            throw new Error("No version item found");
        })
        .then(version => {
            return wrap(
                EBS.describeEnvironments.bind(EBS),
                {
                    ApplicationName: ApplicationName
                }
            )
                .then(envs => {
                    console.log("Environments", inspect(envs));
                    let item = envs.Environments.find(item => item.EnvironmentName === EnvironmentName);
                    if (!item) {
                        throw new Error("EnvironmentName " + EnvironmentName + " is not present in " + ApplicationName);
                    } else if (item.VersionLabel === version.VersionLabel) {
                        throw new Error("Application version " + version.VersionLabel + " already deployed");
                    }
                    return version;
                });
        })
        .then(version => {
            let data = {
                ApplicationName: ApplicationName,
                EnvironmentName: EnvironmentName,
                VersionLabel: version.VersionLabel
            };
            console.log("UPDATE-ENV", inspect(data));
            return wrap(EBS.updateEnvironment.bind(EBS), data);
        })
        .then(result => {
            console.log("DEPLOYING", inspect(result));
            if (job.id !== null) {
                console.log("NOTIFY-PIPE-LINE", inspect({
                    jobId: job.id
                }));
                return wrap(
                    PIPE_LINE.putJobSuccessResult.bind(PIPE_LINE),
                    {
                        jobId: job.id
                    }
                ).then(data => {
                    console.log("NOTIFY-PIPE-LINE-RESULT", inspect(data));
                    return callback(null, "Started deployment of " + result.VersionLabel + " and putJobSuccessResult");
                });
            } else {
                return callback(null, "Started deployment of " + result.VersionLabel);
            }
        })
        .catch(error => {
            console.log("ERROR", error);
            if (job.id !== null) {
                console.log("NOTIFY-PIPE-LINE-ERROR", inspect({
                    jobId: job.id,
                    failureDetails: {
                        type: "JobFailed",
                        message: error.toString()
                    }
                }));
                return wrap(
                    PIPE_LINE.putJobFailureResult.bind(PIPE_LINE),
                    {
                        jobId: job.id,
                        failureDetails: {
                            type: "JobFailed",
                            message: error.toString()
                        }
                    }
                ).then(data => {
                    console.log("NOTIFY-PIPE-LINE-ERROR-RESULT", inspect(data));
                    return callback(error);
                });
            }
            return callback(error);
        })
        .catch(error => callback(error));
};
/**
 * Inspect
 * @param data
 * @returns {*}
 */
function inspect(data) {
    return util.inspect(data, {colors: false, depth: 10});
}
/**
 * Wrap functions to promise
 * @param execute
 * @param params
 * @returns {Promise}
 */
function wrap(execute, params) {
    return new Promise(function (resolve, reject) {
        execute(params, (error, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
        })
    })
}