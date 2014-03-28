var express = require('express'),
    path    = require('path');

var appPath = path.dirname(require.main.filename).replace(/\\/g,'/'),
    mulletPath = require.resolve('mullet').replace(/\/index\.js$/,'').replace(/\\/g,'/'),
    app = express();

app.use(express.json());
app.use(express.urlencoded());

module.exports = {
    
    config:
    {
        port:           3000,
        path:           appPath,
        mulletPath:     mulletPath,
        mainApp:        '', // app served at node root (ie 'localhost:3000/')
        adminHost:      '', // host for admin site in a multi-site environment
        dbdriver:       'db_file',
        siteTitle:      '',
        devel:          true,
        cleanOnStart:   false,
        sessions:       {},
		app:			app,
		_express:		express,
        _apps:          {}  // filled at runtime, not an option
    },
    
    express:    app
    
};