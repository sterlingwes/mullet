#! /usr/bin/env node

// TODO: check whether there's a mullet app in this directory

var Cli = require('simpcli')
  , forever = require('forever')
  , fs = require('fs')
  , spawn = require('child_process').spawn
  , pathlib = require('path')
  , mkdirp = require('mkdirp')
  , PromiseApi = require('es6-promise')
  , Promise = PromiseApi.Promise
  , exec = require('child_process').exec
  , config = require('./config')
  , Apps = require('./apps');

config.path = 'D:/Dev/Vagrant/mulletapp';
var apps = new Apps(config)

  , MulletCli = {

        /*
         * start() - runs mullet app.js
         * 
         * TODO: find a way to use forever to do this
         */
        'start': function() {
            this.print('Starting your app...');
            exec('node app.js', function(err, stdout, stderr) {
                // TODO: run checks for whether app.js exists (package.json, common main file names)
                if(err) return this.print(err);
                else    this.print(stdout, stderr);
            }.bind(this));
        },
      
        'mongo': function(args) {
            
            var pids;
            try {
                pids = require(pathlib.resolve('./proclock.json'));
            } catch(e) {
                pids = {};
                this.print(e);
            }
            
            if(args && args=='stop') {
                if(!pids.mongo)
                    return this.print('Mongo is not running.');
                
                try {
                    process.kill(pids.mongo, 'SIGINT');
                    this.print('Mongo stop signalled');
                } catch(e) {
                    this.print(e);
                }
                
                delete pids.mongo
                fs.writeFileSync('./proclock.json', JSON.stringify(pids));
                return;
            }
            
            if(pids.mongo)
                return this.print('Mongo already appears to be running.');
            
            this.print('Starting mongo...');
            mkdirp('logs', function(err) {
                
                var outFD = fs.openSync(pathlib.resolve( './logs/stdout' ), 'a')
                  , errFD = fs.openSync(pathlib.resolve( './logs/stderr' ), 'a');
                
                var child = spawn('c:/users/wes/documents/apps/mongodb/bin/mongod', ['--dbpath','c:/users/wes/documents/data/mongodb'], {
                    stdio:      ['ignore', outFD, errFD],
                    detached:   true
                });
                
                pids['mongo'] = child.pid;
                fs.writeFileSync('./proclock.json', JSON.stringify(pids));
                
                child.unref();
                
            });
        },
      
        /*
         * list - lists all installed apps
         */
        'list': function() {
            apps.traverseAll().then(function(drs) {
                this.print('Apps found:', Object.keys(drs).join(', '));
            }.bind(this));
        },

        /*
         * run - runs a given shell command in each app directory
         * 
         * - cmd, string : command to run
         * 
         * returns a promise that resolves to result array (typically [err,res])
         */
        'run': function(cmd) {
            return apps.traverseAll().then(function(apps) {
                return Promise.all( Object.keys(apps).map(function(name) {
                    var app = apps[name];
                    return new Promise(function(res,rej) {
                        exec(cmd, { cwd: app.base }, function(err, stdout, stderr) {
                            res({
                                app:    name,
                                err:    err,
                                stdout: stdout,
                                stderr: stderr
                            });
                        });
                    });
                }) );
            });
        },

        'status': function() {

            this.print("\nChecking app statuses...");

            MulletCli.run('git status')
            
                .then(function(res) {
                    res.forEach(function(resp) {
                        var str = '- ' + resp.app + ': ';
                        
                        if(resp.err)
                            str += 'no repo';
                        else
                            str += resp.stdout.indexOf('not staged')>0 
                                    ? 'dirty' 
                                    : ( resp.stdout.indexOf('nothing to commit')>0 
                                        ? 'clean' 
                                        : ( resp.stdout.indexOf('untracked files present')>0
                                            ? 'dirty'
                                            : resp.stdout 
                                          )
                                      );
                        
                        this.print(str);
                        
                    }.bind(this));
                }.bind(this));
        },

        'test': function() {
            
            this.print("\nRunning all app tests...");
            
            MulletCli.run('jasmine-node spec')
            
                .then(function(res) {
                    res.forEach(function(r) {
                        var str = '- ' + r.app + ': ';
                        
                        if(r.err)
                            str+= 'error';
                        else if(r.stderr || r.stdout.indexOf("Failures:\n\n")>0)
                            str+= 'failed';
                        else if(r.stdout.indexOf("spec is missing")>0)
                            str+= 'no specs';
                        else
                            str+= 'passed';
                        
                        this.print(str);
                        
                    }.bind(this));
                }.bind(this))
        },

        'help': function() {
            this.print('Help? Too bad.');
        }

    }

  , cli = new Cli(MulletCli);

cli.chain.then(function() {
    // do something before about to exit
})
.catch(function(err) {
    cli.print('Error:', err.stack);
});