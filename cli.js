#! /usr/bin/env node

var PromiseApi = require('es6-promise')
  , Promise = PromiseApi.Promise
  , exec = require('child_process').exec
  , path = require('path')
  , config = require('./config')
  , Apps = require('./apps');

function Cli(argList, flags) {
    this.args = process.argv.slice(2);
    
    this.tasks = this.args.map(function(arg, idx) {
        var tdef = argList[arg],
            task = tdef && typeof tdef === 'object' 
                    ? Object.create(argList[arg]) 
                    : ( typeof tdef === 'function' ? { fn: tdef } : false );
        if(task) {
            task.name = arg;
            task.pos = idx;
        }
        return task;
        
    }).filter(function(task) { return !!task; });
    
    this.flags = this.args.filter(function(arg) {
        return arg.indexOf('-')==0;
    });
    
    this.argList = argList;
    this.flagList = flags;
    
    var promise = Promise.resolve();

    this.chain = this.tasks.reduce(function(sequence, task) {
        return sequence.then(function(last) {
            return this.runTask(task);
        }.bind(this));
    }.bind(this), promise);
}

Cli.prototype.getArgs = function(pos) {
    var args = this.args.slice(pos+1)
      , foundOther = false;

    return args.filter(function(arg) {
        if(this.argList[arg])   foundOther = true;
        return !foundOther && arg;
    }.bind(this));
};

Cli.prototype.defer = function(resolver) {
    return new Promise(resolver);
};

Cli.prototype.exec = exec;

Cli.prototype.runTask = function(taskCfg) {
    var args = this.getArgs(taskCfg.pos);
    return taskCfg.fn ? taskCfg.fn.apply(this, args) : console.warn('Invalid taskCfg '+taskCfg.name);
};
    
Cli.prototype.print = function() {
    console.log.apply(console, [].slice.call(arguments,0));
};


config.path = 'D:/Dev/Vagrant/mulletapp';
var apps = new Apps(config)

  , MulletCli = {

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
                            str += resp.stdout.indexOf('not staged')>0 ? 'dirty' : ( resp.stdout.indexOf('nothing to commit')>0 ? 'clean' : resp.stdout );
                        
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
    console.error(err);
});