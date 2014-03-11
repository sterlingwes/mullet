var express = require('express'),
    http    = require('http'),
    path    = require('path'),
    _       = require('underscore');

var appPath = path.dirname(require.main.filename).replace(/\\/g,'/'),
    mulletPath = require.resolve('mullet').replace(/\/index\.js$/,'').replace(/\\/g,'/'),
    app = express();

app.use(express.bodyParser());

global.Mullet = {
    
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

exports.start = function(config) {
    if(typeof config === "object")
    {
        for(key in config)
        {
            if(typeof Mullet.config[key] !== 'undefined')
                Mullet.config[key] = config[key]; // only override defaults
        }
    }
    
    Mullet._appman = require('./apps.js')(Mullet.config);
    
    Mullet._appman.setup()
    
        .then(function(apps) {
            if(!apps)
                return console.error('! Failed to load any apps, ending.');
            
            _.extend(Mullet.config._apps, apps);
            
            app.listen(3000);
            console.log('- Listening on port 3000');
            
        }).catch(function(err) {
            console.error('!!! ', err.stack);
        });
};