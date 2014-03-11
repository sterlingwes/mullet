var RSVP = require('rsvp'),
    fs = require('fs'),
    modPath = require.resolve('mullet').replace(/[\/\\]index\.js$/,'').replace(/\\/g,'/'),
    _ = require('underscore'),
    walk = require('walk');

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
        
        promise = new RSVP.Promise(function(resolve, reject) {
            
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
                        dir.core = basePath == modPath,
                        dir.base = [basePath, Apps.DIR, dirName].join('/');
                        
                        if(typeof compLoc === "object")
                            _.extend(compLoc, dir);
                        else
                            apps[dir.name.toLowerCase()] = dir;
                    });
                }
                next();
            });
            
			/*
            walker.on('file', function(root, fstat, next) {
                
                var dots = fstat.name.split('.'),
                    type = dots.pop().toLowerCase();
                
                var compRoot = root.replace(compPath,'').replace(/^\//,''),
                    fullPath = [ root, fstat.name ].join('/');
                                
                if(compRoot) { // make sure we're in an app folder
                    
                    var pathParts = compRoot.split('/'),
                        parent = pathParts.shift().toLowerCase(),
                        finfo;
                    
                    if(!filetypes[type]) {
                        //console.error('? '+parent+': unknown file type: '+type+', ignored');
                        next(); return;
                    }
                    
                    if(!filetypes[type].locations || !_.contains(filetypes[type].locations, (pathParts[0]||'').toLowerCase())) {
                        next(); return;
                    }
                    
                    if(!apps[parent])
                        apps[parent] = {files:{}};
                    
                    finfo = apps[parent].files[fullPath] = _.pick(fstat, 'mtime','name');
                    finfo.type = type;
                    finfo.location = pathParts[0]||'';
                    finfo.handlers = filetypes[type].handlers;
                }
                next();
            });*/
            
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
    var fnStr = func.toString().replace(Apps.STRIP_COMMENTS, '');
    var result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(/([^\s,]+)/g);
    if(result === null)
        result = [];
    return result;
};

Apps.prototype.getAppArgs = function(app, args) {
	var appArgs = _.map(args, function(arg) {
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

/**
 * require() - searches mullet app directory and mullet module apps directory
 *
 * - modname: string, app required
 * - apps: object hash, app state and runtime properties
 *
 * returns result of native require() (should be app api returned from main.js)
 **/
Apps.prototype.require = function(modname, apps) {

    var req,
        count = 0,
        searchPaths = [
            [this.path, Apps.DIR, modname, Apps.MAIN].join('/'), // appPath
            [modPath, Apps.DIR, modname, Apps.MAIN].join('/') // modPath
        ],
        selfi = this;
		
	var mod = apps[modname];

	if(mod && !mod.isLoaded)
	{   
		if(_.every(mod.deps, function(dep) {
			if(["config","req"].indexOf(dep)!=-1)
				return true;
			
			return apps[dep] && apps[dep].isLoaded;
		}))
		{
			// load deps for injection
			var deps = _.map(mod.deps, function(dep) {
				switch(dep) {
					case "config":
						return _.clone(selfi.config);
					case "req":
						return selfi.require.bind(selfi);
				}
				
				var api = apps[dep] ? apps[dep].api : false;
				
				if(api && api.constructorArgs) {
					api = new (api.bind.apply(api, selfi.getAppArgs(mod, api.constructorArgs)))();
				}
					
				return api;
			});
			
			// returned value becomes the app's exposed controller class
			if(mod && typeof mod.main ===  "function") {
				console.log('  - '+modname);
				req = mod.api = mod.main.apply(null, deps);
			}
			if(!mod) mod = {};
			if(!mod.api) req = mod.api = false;
			
			mod.isLoaded = true;
			this.loaded++;
		}
		else
			this.skipped = true;
	}
	else if(mod && (mod.isLoaded || mod.api)) {
        req = mod.api;
		this.loaded++;
	}
	else {
    
		while(!req && count < 2) {
			var path = searchPaths[count];
			try {
				var reqFn = require(path);
				if(apps && typeof apps === "object") {
					var deps = this.getDeps(reqFn),
						depsArray = _.map(deps, function(dep) {
							switch(dep) {
								case "config":
									return _.clone(selfi.config);
								case "req":
									return selfi.require.bind(selfi);
							}
							
							return apps[dep] ? apps[dep].api : false;
						});
					
					req = reqFn.apply(null, depsArray);
				}
				else
					req = reqFn();
					
				var app = mod || { name: modname };
				
				app.api = req;
				app.isLoaded = true;
			}
			catch(e) {
				if(e.code != 'MODULE_NOT_FOUND') {
					console.error('! Apps.require("'+modname+'") failed due to error in app', e.stack);
					this.loaded++; // avoid infiniloop
				}
			}
			count++;
		}
		
		if(!req)    console.warn('! No apps named '+modname+' could be found.');
	}
    
    return req;
};

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

/**
 * setup() - loads apps
 *
 * returns an object literal defining this application's apps
 **/
Apps.prototype.setup = function() {
    
    var apps = {},
        deps = [],
        selfi = this;
    
    //
    // traverse known locations for app directories (app root and this app's root)
    //
    return this.traverse(selfi.path) // app root
    .then(function(dirs) {
        return selfi.traverse(modPath, dirs); // mullet root
    })
    
    //
    // locate app directories and determine dependencies
    //
    .then(function(dirs) {
        
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

            var deps = selfi.getDeps(cmain.main);
            
            apps[name] = _.extend(cmain, {
                deps:   deps
            });
        });
        
        return apps;
        
    }, function(e) {
        if(e)
            console.error('! Problem traversing directory '+ e.path);
    })
    
    //
    // load apps and instantiate in memory for cross app dependency injection
    //
    .then(function(cs) {
        
        var toload = 0, // app hash
            lastload = -1;
			
        selfi.loaded = 0;
        selfi.skipped = false;
        
        var entryApps = _.filter(cs, function(c,name) {
				var vhost = c && c.info && c.info.mullet && c.info.mullet.vhost;
				return typeof vhost === 'string' ? true : false;
			}),
			
			allDeps = _.without(
			
				_.sortBy(selfi.buildDepTree(cs, entryApps), function(name) {
					var a = cs[name]
					  , inf = a && a.info && a.info.mullet
					  , def = inf && inf.vhost ? 1000 : 0;
					  
					return inf && inf.priority ? inf.priority : def;
				}), 
			
				'config', 'req'), // without
            
            missing = _.filter(_.difference(allDeps, _.keys(cs)), function(appn) {
                if(/^db_/.test(appn))   return false; // don't count db_* apps as missing, they should be injected with false when required as dep
                return true;
            });
		
        var actualMissing = _.without(missing,'config','req');
        if(actualMissing.length) {
            console.error('! Missing app dependencies: '+ actualMissing.join(' ') + ' - check case?');
            return cs;
        }
		
		toload = allDeps.length;
        
        console.log('+ Loading '+toload+' app'+(toload==1?'':'s'));
		
		var itmax = 10
		  , count = 0;
        
        while(selfi.loaded != toload && count<itmax)
        {
            selfi.skipped = false;
            
            _.each(allDeps, function(cname) {
			
				selfi.require(cname, cs);
            });
            
            if(selfi.skipped && selfi.loaded == lastload) {
                console.error('! Circular load issue with app dependencies.');
                return;
            }
            
            lastload = selfi.loaded;
			count++;
        }
        
        return cs;
        
    });
};

/*
 * app = router instance
 */
function Apps(config) {
    
    if(!(this instanceof Apps)) {
        return new Apps(config);
    }

    this.path = config.path;
    this.config = config;
}

module.exports = Apps;