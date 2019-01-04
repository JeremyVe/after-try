'use strict';

/* eslint-disable no-param-reassign */

const isArray = require('lodash/isArray');

const isRetryAllowed = require('is-retry-allowed');

const HTTP_METHODS = ['get', 'head', 'options', 'post', 'put', 'delete'];

const IDEMPOTENT_HTTP_METHODS = ['get', 'head', 'options', 'put', 'delete'];

const namespace = 'after-try';

function isNetworkError(error) {
	return (
		!error.response &&
		Boolean(error.code) && // Prevents retrying cancelled requests
		error.code !== 'ECONNABORTED' && // Prevents retrying timed out requests
		isRetryAllowed(error)
	); // Prevents retrying unsafe errors
}

function exponentialDelay(retryNumber = 0) {
	const delay = 2 ** retryNumber * 100;
	const randomSum = delay * 0.2 * Math.random(); // 0-20% of the delay
	return delay + randomSum;
}

const isRetryableError = ({retriableMethods}) => error => {
	if (!isArray(retriableMethods)) {
		throw new Error('unexpected: retriableMethods must be an array');
	}

	if (!error.config) {
		// Cannot determine if the request can be retried
		return false;
	}

	if (!retriableMethods.includes(error.config.method)) {
		return false;
	}

	if (isNetworkError(error)) {
		return true;
	}

	if (!error.response) {
		return true;
	}

	if (error.response.status >= 500 && error.response.status <= 599) {
		return true;
	}

	return false;
};

function fixConfig(axios, config) {
	if (axios.defaults.agent === config.agent) {
		delete config.agent;
	}
	if (axios.defaults.httpAgent === config.httpAgent) {
		delete config.httpAgent;
	}
	if (axios.defaults.httpsAgent === config.httpsAgent) {
		delete config.httpsAgent;
	}
}

function getRequestOptions(config, defaultOptions) {
	return Object.assign({}, defaultOptions, config[namespace]);
}

function getCurrentState(config) {
	const currentState = config[namespace] || {};
	currentState.retryCount = currentState.retryCount || 0;
	config[namespace] = currentState;
	return currentState;
}

function setupRetry(axiosClient, defaultOptions) {
	axiosClient.interceptors.request.use(config => {
		const currentState = getCurrentState(config);
		currentState.lastRequestTime = Date.now();
		return config;
	});

	axiosClient.interceptors.response.use(null, error => {
		const {config} = error;
		// If we have no information to retry the request
		if (!config) {
			return Promise.reject(error);
		}

		const {
			retries = 3,
			retryCondition = isRetryableError({
				retriableMethods: IDEMPOTENT_HTTP_METHODS
			}),
			retryDelay = exponentialDelay,
			shouldResetTimeout = false
		} = getRequestOptions(config, defaultOptions);

		const currentState = getCurrentState(config);

		const shouldRetry =
			retryCondition(error) && currentState.retryCount < retries;

		if (shouldRetry) {
			currentState.retryCount += 1;
			const delay = retryDelay(currentState.retryCount, error);

			// Axios fails merging this configuration to the default configuration because it has an issue
			// with circular structures: https://github.com/mzabriskie/axios/issues/370
			fixConfig(axiosClient, config);

			if (
				!shouldResetTimeout &&
				config.timeout &&
				currentState.lastRequestTime
			) {
				const lastRequestDuration =
					Date.now() - currentState.lastRequestTime;
				// Minimum 1ms timeout (passing 0 or less to XHR means no timeout)
				config.timeout = Math.max(
					config.timeout - lastRequestDuration - delay,
					1
				);
			}

			config.transformRequest = [data => data];

			// Fix, otherwise baseURL will be appended again resulting in
			// => http://api.aftership.com/http://api.aftership.com/admin/endpoint
			if (/^http/.test(config.url)) {
				config.url = config.url.replace(config.baseURL, '');
			}

			return new Promise(resolve =>
				setTimeout(() => resolve(axiosClient(config)), delay)
			);
		}

		return Promise.reject(error);
	});
}

module.exports = {
	setupRetry,
	isRetryableError,
	IDEMPOTENT_HTTP_METHODS,
	HTTP_METHODS
};
