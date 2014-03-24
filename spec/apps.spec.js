var Apps = require('../apps.js')
  , path = require('path')
  , express = require('express')
  , config = {
      
        port:           3000,
        path:           path.resolve( path.join( __dirname , '../../mulletapp') ),
        mulletPath:     path.resolve( path.join( __dirname , '..') ),
        mainApp:        '', // app served at node root (ie 'localhost:3000/')
        adminHost:      '', // host for admin site in a multi-site environment
        dbdriver:       'db_file',
        siteTitle:      '',
        devel:          true,
        isTesting:      true,
        cleanOnStart:   false,
        sessions:       {},
		app:			express(),
		_express:		express,
        _apps:          {}  // filled at runtime, not an option
      
  }
  , appInfo = {}
  , depTree = []
  , appman = new Apps(config);

describe('Mullet App Manager', function() {
    
    it('should load', function() {
        expect(appman.config).toEqual(config);
    });
    
    it('should traverse and return main apps', function(done) {
        appman.traverse(appman.path)
        .then(function(dirs) {
            return appman.traverse(appman.config.mulletPath, dirs);
        })
        .then(function(dirs) {
            return appman.buildInfo(dirs);
        })
        .then(function(apps) {
            appInfo = apps;
            var appKeys = Object.keys(apps[Object.keys(apps)[0]]);
            [
                'mtime', 
                'name', 
                'type', 
                'files', 
                'core', 
                'base', 
                'main', 
                'info', 
                'deps', 
                'depFor'
                
            ].forEach(function(key) {
                expect(appKeys).toContain(key);
            });
            
            done();
        })
        .catch(function(e) {
            console.error(e);
            done();
        });
    });
    
    it('should build the dep load order properly', function() {
        depTree = appman.getLoadOrder(appInfo, appman.buildDepTree(appInfo, [appInfo.cmsdemo]));

        // config
        // sessions:    config
        // server:      config, sessions
        // db_file:     config
        // tasker:      config
        // db:          db_file
        // users:       server, db (db_file), sessions
        // cmsdemo:     db (db_file), users, tasker
        
        expect(depTree).toEqual( ['config', 'sessions', 'server', 'db_file', 'tasker', 'db', 'users', 'cmsdemo'] );
        
        expect(depTree.length).toEqual(8);
    });
    
    it('should load apps asynchronously in sequence', function(done) {
        var promise = appman.loadApps(appInfo);
        expect(promise.constructor.name).toEqual('Promise');
        promise.then(function(apps) {
            var loadedApps = _.filter(apps, function(app) {
                return app && typeof app.api !== "undefined";
            });
            expect(loadedApps.length).toBe(8);
            done();
        });
    });
    
});