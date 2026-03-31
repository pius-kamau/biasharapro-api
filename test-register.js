const http = require('http');

const data = JSON.stringify({
    businessName: "Kenya Hardware Ltd",
    kraPin: "P051234567Z",
    businessEmail: "info@kenyahardware.co.ke",
    businessPhone: "0712345678",
    ownerFirstName: "John",
    ownerLastName: "Mwangi",
    ownerEmail: "john@kenyahardware.co.ke",
    ownerPhone: "0722123456",
    password: "Password123!",
    industry: "retail",
    location: "Nairobi"
});

const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let responseData = '';
    
    res.on('data', (chunk) => {
        responseData += chunk;
    });
    
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Response:', JSON.parse(responseData));
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();