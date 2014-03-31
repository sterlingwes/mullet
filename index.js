var _ = require('underscore')
  , Mullet;

var api = {
    
    init: function(config) {
        
        var defaults = require('./config');
        _.extend( defaults.config, config || {} );
        Mullet = defaults;

        Mullet._appman = require('./apps.js')(Mullet.config);
        return Mullet._appman;
    },
    
    start: function(config) {
        
        var app = api.init(config);
        
        app.setup()
        
            .then(function(apps) {
                if(!apps)
                    return console.error('! Failed to load any apps, ending.');

                _.extend(Mullet.config._apps, apps);

                if(Mullet.config.runOnInit) {
                    Mullet.config.app.listen(3000);
                    console.log('- Listening on port 3000');
                }

            }).catch(function(err) {
                console.error('!!! ', err.stack);
            });
    },
    
    traverse: function(config) {
        
        var app = api.init(config);
        return app.traverseAll();
        
    }
    
};

module.exports = api;