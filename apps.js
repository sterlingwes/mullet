var PromiseApi = require('es6-promise')
    Promise = PromiseApi.Promise,
    fs = require('fs'),
    _ = require('underscore'),
    walk = require('walk'),
    topo = require('toposort');

Apps.STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
Apps.DIR = 'apps';
Apps.MAIN = 'main.js';
Apps.VALIDNAME = /^[$a-z_][0-9a-z_$]*$/i;
Apps.RESERVED =  ['abstract','as','boolean','break','byte','case','catch','char','class','continue','const','debugger','default','delete','do','double','else','enum','export','extends','false','final','finally','float','for','function','goto','if','implements','import','in','instanceof','int','interface','is','long','namespace','native','new','null','package','private','protected','public','return','short','static','super','switch','synchronized','this','throw','throws','transient','true','try','typeof','use','var','void','volatile','while','with',
                  
                 'client','config','req']; // reserved by app sub folder naming

/**
 * traverse() - traverses app directory for apps folders
 *
 * POTENTIAL workflow (not fully implemented)
 *
 * 1 - gets the apps and their directory structure
 * 2 - checks against prior structure for changes since last time server was run
 * 3 - saves structure to FS for potential diff on next run
 * 4 - initiates FS.watch in order to keep up with changes while running
 * 5 - on exit or SIGINT, saves last structure over #3 if possible
 *
 * returns a promise that resolves to an array of app directories
 **/
Apps.prototype.traverse = function(basePath, existing) {
    
    var selfi = this,
        walker,
        compPath = [ basePath, Apps.DIR ].join('/'),
        apps = existing || {},
        
        promise = new Promise(function(resolve, reject) {
            
            walker = walk.walk(compPath, {
                followLinks: true,
                filters: []
            });
            
            walker.on('directories', function(root, dirStats, next) {
                var dirs = _.map(dirStats, function(dir) {return _.pick(dir,'mtime','name','type');});

                if(root==compPath) {
                    // app folders
                    _.each(dirs, function(dir) {
                        var dirName = dir.name.toLowerCase();
                            compLoc = apps[dir.name.toLowerCase()];
                        
                        if(!Apps.VALIDNAME.test(dirName)) {
                            console.error('! App '+dirName+' has an invalid name (letters, numbers, _ or $ only)');
                            next(); return;
                        }
                        
                        if(_.contains(Apps.RESERVED, dirName)) {
                            console.error('! App '+dirName+' has an invalid name (it\'s reserved in javascript)');
                            next(); return;
                        }

                        dir.files = {};
                        dir.core = basePath == selfi.config.mulletPath,
                        dir.base = [basePath, Apps.DIR, dirName].join('/');
                        
                        if(typeof compLoc === "object")
                            _.extend(compLoc, dir);
                        else
                            apps[dir.name.toLowerCase()] = dir;
                    });
                }
                next();
            });
            
            walker.on('errors', function(root, nodeStatsArray, next) {
                console.error('! File system traverse errors');
                next();
            });
            
            walker.on('end', function() {
                resolve(apps);
            });
            
        });
    
    return promise;
    
    
};

/**
 * getDeps() - borrows from AngularJS dependency injection for app load() inspection
 *
 * returns an array of strings representing variable names used in provided function
 **/
Apps.prototype.getDeps = function(func) {

	// TODO: make note that all apps should have lowercase folder names in order to comply with aNyCaSe dep injection
	// *or* store an 'original' value of the app's folder name in the app prop hash and base all FS lookups on that, while indexing by lowerCase name

	if(typeof func !== 'function')	return [];
    var fnStr = func.toString().replace(Apps.STRIP_COMMENTS, '');
    var result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(/([^\s,]+)/g);
    if(result === null)
        result = [];
	
    return _.map(result, function(dep) { return dep.toLowerCase(); });
};

/**
 * getAppArgs() - grabs arguments required by apps that return an object prototype
 *                the Object.constructorArgs parameter (array) of the object defines
 *                which arguments should be passed to the constructor on instantiation
 *                before injecting the object instance into the app upon which it depends
 * 
 * TODO: probably shouldn't require devs to explicitly define 'constructorArgs'
 * 
 * - app, object hash of app properties (mullet configuration and package.json mashup)
 * - args, array of strings corresponding to the properties that should be passed to the
 *   object instance. appName means app['name'], whereas simply 'app' clones the entire
 *   object in the first parameter to getAppArgs
 */
Apps.prototype.getAppArgs = function(app, args) {
	var appArgs = _.map(args, function(arg) {
        
        if(arg == 'app')
            return _.clone(app);
        
		var path = arg.split('.')
		  , firstArg = path.shift();
		  
		if(firstArg.indexOf('app')==0)
			firstArg = firstArg[3].toLowerCase() + firstArg.substr(4);
		  
		var fulfilled = app[firstArg];
		  
		if(!fulfilled || typeof fulfilled !== 'object')	return fulfilled;
		while(path.length && fulfilled) {
			var nextArg = path.shift();
			if(nextArg.indexOf('app')==0)
				nextArg = nextArg[3].toLowerCase() + nextArg.substr(4);
				
			fulfilled = fulfilled[nextArg];
		}
		
		return path.length ? undefined : fulfilled;
	});
	
	appArgs.unshift(null);
	return appArgs;
};

/*
 * buildDepTree - iterates over the apps to grab dependencies
 * 
 * - apps, object hash of all apps found in the file system
 * - roots, array of strings or objects of the form witnessed in 'apps', above, representing all
 *   "entry" apps (those with vhost specified that serve to specific domains)
 * - depTree, an array of strings representing deps found. Undefined for the initial call.
 *   Iterative calls to buildDepTree will pass the latest copy of the tree here.
 * 
 * returns array of dep names sorted by the order in which they should be called based on depFor
 */
Apps.prototype.buildDepTree = function(apps, roots, depTree) {

	var tree = _.isArray(depTree) ? depTree.slice(0) : []
	  , selfi = this;
	  
	if(!roots || !_.isArray(roots))
		return tree;
		
	if(!depTree)
		Array.prototype.push.apply(tree, _.pluck(roots, 'name'));

	_.each(roots, function(app) {
	
		if(typeof app === 'string') {
			app = apps[app] || {};
		}
	
		if(_.isArray(app.deps)) {
			Array.prototype.push.apply(tree, app.deps);
			Array.prototype.push.apply(tree, selfi.buildDepTree(apps, app.deps, tree));
		}
	});
	
    return _.uniq(tree);

};

/*
 * getLoadOrder() - uses list of apps from buildDepTree to determine load order via
 *                  topological sort
 * 
 * - apps, object
 * - appList, array of strings for app names to get edges for
 * 
 * returns array of strings for first valid load order
 */
Apps.prototype.getLoadOrder = function(apps, appList) {
    
    var edges = [];

    _.each(appList, function(name) {
        var app = apps[name];
        if(!app)    return;
        [].push.apply(edges, _.map(app.deps, function(dep) {
            return [ app.name, dep ];
        }));
    });
    
    edges = topo(edges);
    edges.reverse();
    return edges;
    
};

/*
 * buildInfo() - loads app runtime info and returns (goes into this.apps)
 */
Apps.prototype.buildInfo = function(dirs) {
    var apps = {}
      , selfi = this;
    
    _.each(dirs, function(dir) {
        var cmain = dir || {},
            name = dir.name,
            reqpath = [dir.base, Apps.MAIN].join('/'),
            infpath = [dir.base, 'package.json'].join('/');

        try {
            cmain.main = require(reqpath);
        } catch(e) {
            if(e.code == 'MODULE_NOT_FOUND')
                console.error('! Mullet app "'+name+'" not loaded. Did you forget your main.js file? ', e);
            else
                console.error('! require('+reqpath+') ' + e.stack);

            return;
        }

        // try loading package.json, fail silently
        try {
            cmain.info = require(infpath);
        } catch(e) {}

        if(typeof cmain !== "object" && typeof cmain !== "function") {
            console.error('! Mullet app "'+name+'" invalid type, no load method in exported object.', typeof cmain);
            return;
        }

        var deps = _.map(selfi.getDeps(cmain.main), function(dep) {
            return dep=='db__driver' ? selfi.config.dbdriver : dep;
        });

        apps[name] = _.extend(cmain, {
            deps:       deps,
            depFor:     []
        });
    });

    // add to depFor tracking list for reliant apps

    _.each(apps, function(app) {
        if(_.isArray(app.deps))
            _.each(app.deps, function(dep) {
                if(!apps[dep])  return;
                var depFor = apps[dep].depFor;
                if(depFor.indexOf(app.name)==-1)
                    depFor.push(app.name);
            });
    });

    return apps;
};

/*
 * load() - loads the designated app api into memory from the return value of main()
 *          also handles dependency injection from previously loaded apps
 * 
 * - appName, string
 * 
 * returns variant representing api for testing purposes / Promise chaining
 */
Apps.prototype.load = function(appName) {
    
    var mod = this.apps[appName];

    switch(appName) {
        case "config":
            var api = _.clone(this.config);
            this.apps.config = {
                name:   'config',
                api:    api
            };
            return api;
    }
    
    if(!mod)
        return;
    
    if(mod.api)
        return this.apps[appName].api;
    
    var selfi = this;
    
    // load deps for injection
    var deps = _.map(mod.deps, function(dep) {

        var api = selfi.apps[dep] ? selfi.apps[dep].api : false;
		
        if(typeof api === 'function' && !(api instanceof Promise)) {
            api = new (api.bind.apply(api, selfi.getAppArgs(mod, api.constructorArgs || selfi.getDeps(api))))();
        }

        return api;
    });

    // returned value becomes the app's exposed controller class
    if(mod && typeof mod.main ===  "function") {
        console.log('  - '+appName);
		var api = mod.main.apply(null, deps);
		if(api instanceof Promise)
			return api.then(function(actualApi) {
				selfi.apps[appName].api = actualApi;
			});
			
        mod.api = api;
    }
    else if(mod && typeof mod.main === 'object')
        mod.api = _.clone(mod.main);
    
    if(!mod) mod = {};
    if(!mod.api) mod.api = false;
    
    return mod.api;
};

Array.prototype.move = function (old_index, new_index) {
    if (new_index >= this.length) {
        var k = new_index - this.length;
        while ((k--) + 1) {
            this.push(undefined);
        }
    }
    this.splice(new_index, 0, this.splice(old_index, 1)[0]);
    return this; // for testing purposes
};

/*
 * loadApps() - coordinates async loading and checking for missing depedencies
 * 
 * - cs, object passed from traversing managed by setup()
 * 
 * returns a Promise that resolves to the final app hash
 */
Apps.prototype.loadApps = function(cs) {
    this.config._apps = this.apps = cs;
    
    var selfi = this,
    
        entryApps = _.filter(cs, function(c,name) {
            var vhost = c && c.info && c.info.mullet && c.info.mullet.vhost
			  , hasPriority = c && c.info && c.info.mullet && (c.info.mullet.run || !!c.info.mullet.priority);
			  
            return typeof vhost === 'string' || _.isArray(vhost) || hasPriority ? true : false;
        }),

        allDeps = selfi.getLoadOrder(cs,selfi.buildDepTree(cs, entryApps)),
        
        withPriority = _.filter(cs, function(c,name) {
            return c && c.info && c.info.mullet && (c.info.mullet.run || !!c.info.mullet.priority);
        }),

        missing = _.filter(_.difference(allDeps, _.keys(cs)), function(appn) {
            if(/^db_/.test(appn))   return false; // don't count db_* apps as missing, they should be injected with false when required as dep
            return true;
        });

    var actualMissing = _.without(missing,'config','req');
    if(actualMissing.length) {
        console.error('! Missing app dependencies: '+ actualMissing.join(' ') + ' - check case?');
        return cs;
    }
    
	// enforce run ordering over topo sort, need to document that run: first must NOT have deps other than those built-in
	
    if(withPriority.length) {
        _.each(withPriority, function(c) {
			if(allDeps.indexOf(c.name)==-1)
				return;
				
			switch(c.info.mullet.run) {
				case "last":
					allDeps.move( allDeps.indexOf(c.name), allDeps.length-1); break;
				case "first":
					allDeps.move( allDeps.indexOf(c.name), 0); break;
			}
		});
    }

    var toload = _.without(allDeps, 'config').length;

    console.log('+ Loading '+toload+' app'+(toload==1?'':'s'));

    // load with promises for async main() resolving

    return allDeps.reduce(function(lastApp, appName, index) {
        var chain = lastApp.then(function(lastApi) {
            /*if(index==0)
                console.log('START');
            else console.log(allDeps[index-1], typeof lastApi, lastApi && lastApi.constructor && lastApi.constructor.name, typeof lastApi === 'object' ? Object.keys(lastApi) : '');*/
			
			var lastApp = selfi.apps[allDeps[index-1]];
			if(lastApp && !lastApp.api)
				lastApp.api = lastApi;
			
            return selfi.load(appName);
        });
        
        if(index == (allDeps.length-1))
            chain.catch(function(err) {
                console.error(err.stack);
            });
        
        return chain;
        
    }, Promise.resolve()).then(function() {
        return selfi.apps;
    });
};

/*
 * traverseAll() - gets the list of all apps
 */
Apps.prototype.traverseAll = function() {
    var promise = Promise.resolve()
      , selfi = this;
        
    return this.traverse(selfi.path) // app root
    .then(function(dirs) {
        return selfi.traverse(selfi.config.mulletPath, dirs); // mullet root
    });
};

/**
 * setup() - coordinates app loading logic
 *
 * returns a promise that resolves to the object literal defining this application's apps
 **/
Apps.prototype.setup = function() {
    
    var selfi = this;
    
    //
    // traverse known locations for app directories (app root and this app's root)
    //
    return this.traverseAll()
    
    //
    // locate app directories and determine dependencies
    //
    .then(function(dirs) {
        return selfi.buildInfo(dirs);
    })
    
    //
    // load apps and instantiate in memory for cross app dependency injection
    //
    .then(function(cs) {
        return selfi.loadApps(cs);
    });
};

/*
 * Apps - app tree builder & loader
 * 
 * - config, Mullet config object
 */
function Apps(config) {
    
    if(!(this instanceof Apps)) {
        return new Apps(config);
    }

    this.apps = {};
    this.path = config.path;
    this.config = config;
}

module.exports = Apps;