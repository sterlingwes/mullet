var _ = require('underscore');

require('./config');

var api = {
    
    init: function(config) {
        
        if(typeof config === "object")
        {
            for(key in config)
            {
                if(typeof Mullet.config[key] !== 'undefined')
                    Mullet.config[key] = config[key]; // only override defaults
            }
        }

        Mullet._appman = require('./apps.js')(Mullet.config);
        return Mullet._appman;
    },
    
    start: function(config) {

        var app = api.init(config);
        
        Mullet.app.setup()
        
            .then(function(apps) {
                if(!apps)
                    return console.error('! Failed to load any apps, ending.');

                _.extend(Mullet.config._apps, apps);

                if(Mullet.config.runOnInit) {
                    Mullet.app.listen(3000);
                    console.log('- Listening on port 3000');
                }

            }).catch(function(err) {
                console.error('!!! ', err.stack);
            });
    },
    
    traverse: function(config) {
        
        var app = api.init(config);
        return Mullet.app.traverseAll();
        
    }
    
};

module.exports = api;