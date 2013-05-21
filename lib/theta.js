var Model = require('./model')
  , async = require('async')
  , fs = require('fs')
  , clone = require('clone')
  , parse = require('plom-parser')
  , util = require('util');

/**
 * Extend Model
 */
function Theta(context, process, link, theta){

  Model.call(this, context, process, link);

  this.theta = theta;
}

Theta.prototype = Object.create(Model.prototype);
Theta.prototype.constructor = Theta;


/**
 * Adapts theta.json to the context.json process.json and link.json
 */ 

Theta.prototype.adapt = function(){
  this._addDefaults();
  this._repeat();

  return this;
}


Theta.prototype.mutate = function(options, callback){

  var that=this;

  var task = [];

  if(options.zero_sd_ic){
    task.push(function(cb){
      that._zeroSdIc(options);
      cb(null);
    });
  }

  if(options.zero_sd_par){
    task.push(function(cb){
      that._zeroSdPar(options);
      cb(null);
    });
  }

  if(options.best || options.design){
    task.push(function(cb){that.plugBest(options, cb);});
  }

  if(options.state){
    task.push(function(cb){that.plugHat(options, cb);});
  }

  if(options.rescale){
    task.push(function(cb){that.rescale(options, cb);});
  }

  if(options.covariance){
    task.push(function(cb){that.plugCov(options, cb);});
  }

  if(options.set){
    task.push(function(cb){
      that._set(options);
      cb(null);
    });
  }

  if(typeof options.unstick !== 'undefined'){
    task.push(function(cb){
      that._unstick(options);
      cb(null);
    });
  }


  async.series(task, function(err){
    if(err) return callback(err);

    //sanitize
    for(var par in that.theta.parameter){
      for(var group in that.theta.parameter[par]['group']){
        that._sanitize(par, group, options);
      }
    }

    callback(null);

  });

};


/**
 * put values of theta2 into theta for any properties of theta2 also
 * present in theta. Note that the grouping of theta is preserved
 */

Theta.prototype.merge = function(theta2){

  var theta = this.theta;

  for(var par in theta2.value){
    for(var group in theta2.value[par]['group']){
      if((par in theta.value) && (group in theta.value[par]['group'])){
        ['min', 'max', 'guess', 'sd_transf', 'prior'].forEach(function(p){
          theta.value[par]['group'][group][p]['value'] = theta2.value[par]['group'][group][p]['value'];
        });
      }
    }

    ['type', 'unit', 'transformation'].forEach(function(p){
      if(p in theta2.value[par]){
        theta.value[par][p] = theta2.value[par][p]
      }
    });
  }

};



/**
 * generate an array of theta.json (thetas) with initial conditions
 * equal to the sampled smoothed traj (XStrean of X.csv) at time n and
 * parameter from the corresponding MCMC output (bestStream from
 * best.csv).
 *
 * Note that the grouping of the initial condition of the generated
 * theta are set to variable_population
 */

Theta.prototype.predict = function(n, XStream, bestStream, options, callback){

  var that = this;

  //get states 
  var states = [];


  csv()
    .from.stream(XStream, {columns: true})
    .on('record', function(row){

      if(parseInt(row.time, 10) === n){
        for(var key in row){
          row[key] = parseFloat(row[key]);
        }
        states.push(row);
      }

    })
    .on('end', function(){

      //get the parameter values
      var mkeep = states.map(function(x){return x.index;});
      var best = [];


      csv()
        .from.stream(bestStream, {columns: true})
        .on('record', function(row, i){
          if(mkeep.indexOf(parseInt(row.index, 10)) !== -1){
            for(var key in row){
              row[key] = parseFloat(row[key]);
            }
            best.push(row);
          }
        })
        .on('end', function(){

          that.load('metadata', 'N', function(err, pop_size){
            if (err) return callback(err);

            var thetas = []; 

            best.forEach(function(mybest, i){
              //generate the list of thetas
              var mytheta = clone(that.theta);

              //insert best value or drift value from states
              for (var par in mytheta.parameter) {
                for (var group in mytheta.parameter[par].group) {
                  var pg = [par, group].join(':');

                  //parameters
                  if(pg in mybest){
                    mytheta.parameter[par].group[group].guess.value = mybest[pg];
                  }

                  //drift value (and eventually states if ungrouped)
                  if(pg in states[i]){
                    mytheta.parameter[par].group[group].guess.value = states[i][pg];
                  }
                }
              }

              var pop_size_n = {}
                , nSafe;

              if(that.process.pop_size_eq_sum_sv){
                that.context.population.forEach(function(p){
                  var sum_sv = 0.0;
                  that.par_sv.forEach(function(s){
                    sum_sv += states[i][s + ':'  + p.id];              
                  });
                  pop_size_n[p.id] = sum_sv;
                });
              } else {
                nSafe =  (n < pop_size.length ) ? n+1 : pop_size.length-1; //!!!hat can be longer that pop_size
                pop_size[0].forEach(function(pop, i){
                  pop_size_n[pop] = pop_size[nSafe][i];
                });
              }

              _addUngroupedStates(mytheta, that.par_sv, states[i], pop_size_n);
              thetas.push(mytheta);
              
            });

            callback(null, thetas);

          });      
        });
    });
}



/////////////////////////////////////////////////////
//low level methods
/////////////////////////////////////////////////////


Theta.prototype.plugBest = function(options, callback){

  var that = this;

  var pathBest;

  if(options.design){
    pathBest = (typeof options.design === 'boolean') ? "design.csv" : options.design;
  } else {
    pathBest = (typeof options.best === 'boolean') ? "best_0.csv" : options.best;
  }

  fs.exists(pathBest, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s could not be found.', pathBest)));
    }

    parse.objN(fs.createReadStream(pathBest), options.index_best, function(err, best_n){
      if(err) return callback(err);
      that._plugBest(best_n, options);
      callback(null);      
    });

  });

};




Theta.prototype.plugHat = function(options, callback){

  var that = this;
  var pathHat = (typeof options.state === 'boolean') ? "hat_0.csv" : options.state;

  var n = options.index_state;

  fs.exists(pathHat, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s could not be found, now quitting.', pathHat)));
    }

    parse.objN(fs.createReadStream(pathHat), n, function(err, hat_n){
      if(err) return callback(err);

      that.getPopSize(hat_n, n, function(err, pop_size_n){

        if(err) return callback(err);
        that._plugHat(hat_n, pop_size_n, options);
        callback(null);
      });

    });

  });

};


Theta.prototype.rescale = function(options, callback){

  var that = this;

  //resolve path_hat;
  var path_hat = "hat_0.csv"
  if(options.rescale.length === 1){
    if(options.state && (typeof options.state !== 'boolean')){
      path_hat = options.state
    }
  } else {
    path_hat = options.rescale[1];
  }

  fs.exists(pathHat, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s could not be found, now quitting.', pathHat)));
    }

    parse.csvFloat(fs.createReadStream(pathHat), function(err, hat){
      if(err) return callback(err);

      that.load('data', 'data', function(err, data){
        if (err) return callback(err);        
        that._rescale(data, hat, options);
        callback(null);
      });

    });

  });

};

Theta.prototype.plugCov = function(options, callback){

  var that = this;
  var pathCov = (typeof options.covariance === 'boolean') ? "covariance_0.csv" : options.covariance;

  fs.exists(pathCov, function(exists){

    if(!exists) return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s could not be found.', pathCov)));

    parse.csvFloatNoHeaders(fs.createReadStream(pathCov), function(err, cov){
      if(err) return callback(err);

      that.theta.covariance = cov;
      callback(null);
    });

  });

};







Theta.prototype._zeroSdIc = function(options){
  var that = this;

  this.par_sv.forEach(function(par){
    for(group in that.theta.parameter[par]['group']){
      that.theta.parameter[par]['group'][group]['sd_transf']['value'] = 0.0;
    }
  });

  return this;
};


Theta.prototype._zeroSdPar = function(options){
  var that = this;

  this.par_proc.concat(this.par_obs).forEach(function(par){
    for(group in that.theta.parameter[par]['group']){
      that.theta.parameter[par]['group'][group]['sd_transf']['value'] = 0.0;
    }
  });

  return this;
};

/**
 * best_n is a line (n) of best.csv rendered as an object with key from header
 */
Theta.prototype._plugBest = function(best_n, options){

  for(var par in this.theta.parameter){
    for(var group in this.theta.parameter[par]['group']){
      if((par + ':' + group in best_n) && ((!options.preserve) || (this.theta.parameter[par]['group'][group]['sd_transf']['value'] > 0.0))){
        this.theta.parameter[par]['group'][group]['guess']['value'] = best_n[par + ':' + group];
      }
    }
  }

  return this;  
};



/**
 * Helper function
 * put states (hat_n object, with pop_size_n object) into theta (and ensure variable grouping)
 */

function _addUngroupedStates (theta, par_sv, hat_n, pop_size_n){

  var arrayify = function(obj, prop){
    var tab = [];
    for(var g in obj['group']) {tab.push(obj['group'][g][prop]['value'])};
    return tab;
  }

  var vgroup = theta.partition.variable_population.group;

  par_sv.forEach(function(par){

    var par_object = theta.parameter[par]
      , pmin = Math.min.apply(Math, arrayify(par_object, 'min'))
      , pmax = Math.max.apply(Math, arrayify(par_object, 'max'))
      , psd =  Math.min.apply(Math, arrayify(par_object, 'sd_transf'));
   
    //check if all the priors are identical, if not default to 'uniform'
    var priors = arrayify(par_object, 'prior')
      , pprior = priors[0];

    var all_priors_identical = priors.every(function(v, i, a) {
      // first item: nothing to compare with (and, single element arrays should return true)
      // otherwise:  compare current value to previous value
      return i === 0 || v === a[i - 1];
    });
    
    if(!all_priors_identical){
      console.error('\033[93mWARNING\033[0m: all the prior for %s are not identical, setting them all to uniform\n', par);
      pprior = 'uniform'
    }

    par_object.group = {};

    vgroup.forEach(function(g) {
      par_object.group[g.id] = {
        guess: {value: hat_n[par + ':' + g.id] / pop_size_n[g.id]},
        min: {value: pmin},
        max: {value: pmax},
        sd_transf: {value: psd},
        prior: {value: pprior}
      };

    });

    par_object.partition_id = 'variable_population';
  });

  return theta;

};



/**
 * extend grouping (if required), place hat values in guess and transform pop size into proportion
 * hat_n is a line (n) of hat.csv rendered as an object with key from header
 * pop_size_n is a line (n) of N.csv rendered as an object with key from header
 */

Theta.prototype._plugHat = function(hat_n, pop_size_n, options){

  var that = this;

  if(options.ungroup){
    _addUngroupedStates(that.theta, that.par_sv, hat_n, pop_size_n);
  } else {

    ////////////////////////////////////////////////////////////
    //put states into theta (average states to respect grouping)
    ////////////////////////////////////////////////////////////

    this.par_sv.forEach(function(par) {
      var par_object = clone(that.theta.parameter[par]);

      //we create an hash (p2g) that map population_id -> group_id
      var p2g = {};

      var groups = theta.partition[par_object.partition_id]['group'];
      groups.forEach(function(g){
        g.population_id.forEach(function(pop){
          p2g[pop] = g.id;
        });
      });

      //initialize guess to 0
      for(g in par_object.group) {
        par_object['group'][g]['guess']['value'] = 0.0;
      }

      for(var p in p2g){
        par_object['group'][p2g[p]]['guess']['value'] += hat_n[par + ':' + p] / pop_size_t[p];
      }

      groups.forEach(function(g){
        var x = par_object['group'][g.id]['guess']['value'] / g.population_id.length;

        if((!options.preserve) || (par_object['group'][g.id]['sd_transf']['value'] > 0.0)){
          that.theta.parameter[par]['group'][g.id]['guess']['value'] = x;
        }

      });

    });
  }
};


/**
 * data and hat have headers
 */
Theta.prototype._rescale = function(data, hat, options){

  var reporting = options.rescale[0];
  if(this.par_obs.indexOf(reporting) === -1){
    throw new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s is not an observation process parameter, now quitting.', reporting));
  }

  var mean_data = []
    , mean_hat = []
    , n_data = []
    , n_hat = [];

  for(var ts=0; ts< this.context.time_series.length; ts++){
    mean_data.push(0);
    mean_hat.push(0);
    n_data.push(0);
    n_hat.push(0);
  }

  for(var n=1; n<= data.length; n++){ //skip header
    for(var ts=0; ts< data[0].length; ts++){
      if(data[n][ts] !== null){
        mean_data[ts] += data[n][ts+1]; //skip date
        n_data[ts]++;
      }
    }
  }

  //hat can have a different size that data (if hat comes from simul for instance)!
  var offset_hat = 1+this.par_sv.length*this.context.population.length*3;
  for(var n=1; n<= hat.length; n++){ // skip header
    for(var ts=0; ts< data[0].length; ts++){
      if(hat[n][offset_hat + ts*3] !== null){
        mean_hat[ts] += hat[n][offset_hat + ts*3];
        n_hat[ts]++;
      }
    }
  }

  for(var ts=0; ts< data[0].length; ts++){
    mean_data[ts] /= n_data[ts];
    mean_hat[ts] /= n_hat[ts];
  }

  var par_object = this.theta.parameter[reporting]
    , groups = this.theta.partition[par_object.partition_id]['group'];

  var ts_id = data[0].slice(1);
  //we create a map (here it will be an array) that goes from ts -> group_id
  var map_group = new Array(ts_id.length);

  groups.forEach(function(g){
    g.time_series_id.forEach(function(time_series){
      var ts = ts_id.indexOf(time_series);
      map_group[ts] = g.id;
    });
  });

  //first get the reporting parameter that equal the averages of data and hat assuming variable grp
  var good_reporting = new Array(mean_data.length);
  for(var ts=0; ts< mean_data.length; ts++){
    good_reporting[ts] = mean_data[ts] / (mean_hat[ts] / par_object['group'][map_group[ts]]['guess']['value']);
  }

  //average reporting so that it matches the grouping
  for(var g in par_object.group){
    par_object['group'][g]['guess']['value'] = 0.0;
  }
  for(var ts=0; ts< mean_data.length; ts++){
    par_object.group[ map_group[ts] ]['guess']['value'] += good_reporting[ts];
  }

  groups.forEach(function(g){
    par_object['group'][g.id]['guess']['value'] /= g.time_series_id.length;
  });

  return this;

}



Theta.prototype._set = function(options){
  var that = this;

  var err = [];

  options.set.forEach(function(parString){
    var parsed = parString.split(':');

    var par = parsed[0]
      , group = parsed[1]
      , prop = parsed[2]
      , val = (prop === 'prior') ? parsed[3] : parseFloat(parsed[3], 10)
      , groups;

    //TODO check prior validity

    if(par in that.theta.parameter){

      if(group === 'all'){
        groups = that.theta.partition[ that.theta.parameter[par]['partition_id'] ]['group'].map(function(x){return x.id;});
      } else {
        if (group in that.theta.parameter[par]['group']){
          groups = [group];
        } else {
          return err.push(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s %s is not a valid group, now quitting.', parString, group));
        }
      }

      groups.forEach(function(group_id){

        if(prop in that.theta.parameter[par]['group'][group_id]){
          that.theta.parameter[par]['group'][group_id][prop]['value'] = val;
        } else {
          return err.push(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s %s is not a valid property name.', parString, prop));
        }
      });

    } else {
      return err.push(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': %s %s is not a valid parameter name.', parString, par));
    }

  });

  if(err.length){
    throw new Error(err.join('\n'));
  }

  return this;
};


/**
 * Moves guess from it's boundaries
 */

Theta.prototype._unstick = function(options){

  var mul = options.unstick || 0.0;
  if (mul < 0.0 || mul > 1.0) {
    console.error('\033[91mINVALID ARGUMENT\033[0m: for -u, --unstick [p], p has to be in [0,1]. Setting %d to 0.0.', mul);
    mul = 0.0;
  }

  for (var par in this.theta.parameter){
    for (var group in this.theta.parameter[par]['group']){

      var x = this.theta.parameter[par]['group'][group]['guess']['value']
        , a = this.theta.parameter[par]['group'][group]['min']['value']
        , b = this.theta.parameter[par]['group'][group]['max']['value']
        , transf = this.theta.parameter[par]['transformation'];

      if( (("prior" in this.theta.parameter[par]['group'][group]) && (this.theta.parameter[par]['group'][group]['prior']['value'] === "uniform")) || ( (transf === 'logit_ab' || (transf === 'scale_pow_10_bounded')) ) ){

        if (x <= a) {
          this.theta.parameter[par]['group'][group]['guess']['value'] = a + mul*(b-a);
        } else if (x >= b) {
          this.theta.parameter[par]['group'][group]['guess']['value'] = b - mul*(b-a);
        }

      } else if( ((transf === 'log') || (transf === 'scale_pow_10_pos')) && (x <= 0.0) ){

        this.theta.parameter[par]['group'][group]['guess']['value'] = mul*b;

      } else if(transf === 'logit'){

        if(x<=0.0){
          this.theta.parameter[par]['group'][group]['guess']['value'] = mul*b;
        }

        if(x>=1.0){
          this.theta.parameter[par]['group'][group]['guess']['value'] = 1.0 - mul*(1.0-a);
        }

      }

      if(this.theta.parameter[par]['group'][group]['guess']['value'] !== x){
        console.error('\033[94mINFO\033[0m: unsticked %s:%s (%d->%d)', par, group, x, this.theta.parameter[par]['group'][group]['guess']['value']);
      }      
    }
  }

  return this;

}


Theta.prototype._sanitize = function(par, group, options){

  //ensure that transformation are respected...
  var x = this.theta.parameter[par]['group'][group]['guess']['value'];
  var par_string = [par, group, 'guess'].join(':');
  
  var transf = this.theta.parameter[par]['transformation']
    , prior = this.theta.parameter[par]['group'][group]['prior']['value'];
  
  //log and logit transfo:
  if( ((transf === 'log') || (transf === 'scale_pow_10_pos')) && (x < 0.0) ){
    this.theta.parameter[par]['group'][group]['guess']['value'] = 0.0;
    console.error('\033[93m' + 'WARNING' + '\033[0m' + ': sanitized %s (log) %d -> %d\n', par_string, x, 0.0);

  } else if(transf === 'logit'){

    if(x<0.0){
      this.theta.parameter[par]['group'][group]['guess']['value'] = 0.0;
      console.error('\033[93m' + 'WARNING' + '\033[0m' + ': sanitized %s (logit) %d -> %d\n', par_string, x, 0.0);
    }

    if(x>1.0){
      this.theta.parameter[par]['group'][group]['guess']['value'] = 1.0;
      console.error('\033[93m' + 'WARNING' + '\033[0m' + ': sanitized %s (logit) %d -> %d\n', par_string, x, 1.0);
    }

  }

  if( (transf === 'logit_ab') || (transf === 'scale_pow_10_bounded') || (prior === 'uniform') ){
    //ensure that guess is within min and max
    x = this.theta.parameter[par]['group'][group]['guess']['value'];

    if(x < this.theta.parameter[par]['group'][group]['min']['value']){
      par_string = [par, group, 'min'].join(':');
      console.error('\033[93m' + 'WARNING' + '\033[0m' + ': sanitized %s %d (guess) -> %d (min)', par_string, x, this.theta.parameter[par]['group'][group]['min']['value']);
      this.theta.parameter[par]['group'][group]['guess']['value'] = this.theta.parameter[par]['group'][group]['min']['value'];
    }

    if(x > this.theta.parameter[par]['group'][group]['max']['value']){
      par_string = [par, group, 'max'].join(':');
      console.error('\033[93m' + 'WARNING' + '\033[0m' + ': sanitized %s %d (guess) -> %d (max)', par_string, x, this.theta.parameter[par]['group'][group]['max']['value']);
      this.theta.parameter[par]['group'][group]['guess']['value'] = this.theta.parameter[par]['group'][group]['max']['value'];
    }
  }

};




Theta.prototype._addDefaults = function(){
  var theta = this.theta;

  //transformation
  //par_sv default to 'logit'
  this.par_sv.forEach(function(state){
      theta.parameter[state]['transformation'] = theta.parameter[state]['transformation'] || 'logit';
  });

  //par_proc and par_obs default to 'positive'
  this.par_proc.concat(this.par_obs).forEach(function(par){
      theta.parameter[par]['transformation'] = theta.parameter[par]['transformation'] || 'log';
  });

  var that = this;

  //min, max, sd_transf, prior
  this.par_sv.concat(this.par_proc, this.par_obs).forEach(function(par, i){

    theta.parameter[par]['partition_id'] = theta.parameter[par]['partition_id'] || ((i < (that.par_sv.length + that.par_proc.length)) ? 'identical_population': 'identical_time_series');

    //non expanded
    if(!('group' in theta.parameter[par])){
      
      if('follow' in theta.parameter[par] && !('guess' in theta.parameter[par])) {theta.parameter[par]['guess'] = 0.0;}

      if(!('min' in theta.parameter[par])) {theta.parameter[par]['min'] = theta.parameter[par]['guess']};
      if(!('max' in theta.parameter[par])) {theta.parameter[par]['max'] = theta.parameter[par]['guess']};
      if(!('sd_transf' in theta.parameter[par])) {theta.parameter[par]['sd_transf'] = 0.0};
      theta.parameter[par]['prior'] = theta.parameter[par]['prior'] || 'uniform';

    } else { // expanded

      for(var group in theta.parameter[par]['group']){       
        if('follow' in theta.parameter[par] && !('guess' in theta.parameter[par]['group'][group])) {theta.parameter[par]['group'][group]['guess'] = {value: 0.0} };

        if(!('min' in theta.parameter[par]['group'][group])) {theta.parameter[par]['group'][group]['min'] = {value: theta.parameter[par]['group'][group]['guess']['value']} };
        if(!('max' in theta.parameter[par]['group'][group])) {theta.parameter[par]['group'][group]['max'] = {value: theta.parameter[par]['group'][group]['guess']['value']} };
        if(!('sd_transf' in theta.parameter[par]['group'][group])) {theta.parameter[par]['group'][group]['sd_transf'] = {value: 0.0} };
        theta.parameter[par]['group'][group]['prior'] = theta.parameter[par]['group'][group]['prior'] || {value: 'uniform'};
      }
      
    }

  });
}


Theta.prototype._repeat = function() {
  var theta = this.theta;

  var cac_id = this.context.population.map(function(x){return x.id})
    , ts_id = this.context.time_series.map(function(x){return x.id});

  theta.partition = theta.partition || {};

  theta.partition['variable_population'] = {group: []};
  cac_id.forEach(function(cac){
    theta.partition['variable_population']['group'].push({'id': cac, 'population_id': [cac]});
  });

  theta.partition['variable_time_series'] = {group: []};
  ts_id.forEach(function(ts){
    theta.partition['variable_time_series']['group'].push({'id': ts, 'time_series_id': [ts]});
  });

  theta.partition['identical_population'] = {group: [{'id':'all', 'population_id': cac_id}]};
  theta.partition['identical_time_series'] = {group: [{'id':'all', 'time_series_id': ts_id}]};

  for(par in theta.parameter){
    if(!('group' in theta.parameter[par])){

      theta.parameter[par]['group'] = {};

      theta.partition[theta.parameter[par]['partition_id']]['group'].forEach(function(group){
        theta.parameter[par]['group'][group.id] = {};
        ['min', 'guess', 'max', 'sd_transf', 'prior'].forEach(function(el){          
          theta.parameter[par]['group'][group.id][el] = {'value': theta.parameter[par][el]};
        });
      });

      ['min', 'guess', 'max', 'sd_transf', 'prior'].forEach(function(el){       
        delete theta.parameter[par][el];
      });

    }
  }
}




module.exports = Theta;
