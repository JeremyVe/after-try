# after-try
[![](https://img.shields.io/npm/v/after-try.svg)](https://github.com/JeremyVe/after-try)

> after-try make axios retryable through interceptors

after-try is based off [axios-retry](https://github.com/softonic/axios-retry)

<br />

### setupRetry :
```javascript
const { setupRetry } = require('after-try');

const axiosClient = axios.create();

const retryOptions = {
    retries: 3
}

setupRetry(axiosClient, retryOptions);
```

<br />

### override specific request :
```javascript
axiosClient.get('/user', {
    'after-try': {
        retries: 5,
        retryCondition = () => {
            // you're specific retry condition logic
        }
    }
});
```