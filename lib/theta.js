var Context = require('./context')
  , Model = require('./model')
  , _ = require('underscore')
  , async = require('async')
  , path = require('path')
  , fs = require('fs')
  , csv = require('csv')
  , clone = require('clone')
  , parse = require('plom-parser')
  , reduce = require('plom-reduce')
  , util = require('util');

/**
 * Extend Model
 */
function Theta(context, process, link, theta, options){

  Model.call(this, context, process, link, options);

  this.theta = clone(theta);
}

Theta.prototype = Object.create(Model.prototype);
Theta.prototype.constructor = Theta;


/**
 * Return a copy of the model data for JSON stringification. The
 * name of this method is a bit confusing, as it doesn't actually
 * return a JSON string — but I'm afraid that it's the way that the
 * JavaScript API for JSON.stringify works
 */
Theta.prototype.toJSON = function() {
  return clone({context: this.context, process: this.process, link: this.link, theta: this.theta});
};



//helper function
function checkString(obj, key, objName){    
  if(key in obj){ //usefull for optional keys
    if(typeof obj[key] !== 'string'){
      throw new Error(util.format('in theta.json%s, "%s" has to be a string', (objName) ? ' (' + objName + ')': '', key));
    }
  } else {
    throw new Error(util.format('in theta.json%s, "%s" is missing', (objName) ? ' (' + objName + ')': '', key));
  }
}


Theta.prototype.validate = function(){

  var that = this;

  Context.prototype.validate.call(this);
  Model.prototype.validate.call(this);

 
  var missing = _.difference(['parameter'], Object.keys(this.theta));
  if( missing.length ){
    throw new Error(util.format('in theta.json, %s properties are missing', missing.join(',')));
  }

  if('partition' in this.theta){
    this._validate_partition();
  }  

  //validate parameters
  missing = _.difference(this.par_sv.concat(this.par_proc, this.par_obs), Object.keys(this.theta.parameter));
  if( missing.length ){
    throw new Error(util.format('in theta.json, parameter [%s] are missing', missing.join(',')));
  }

  var aliens = _.difference(Object.keys(this.theta.parameter), this.par_sv.concat(this.par_proc, this.par_obs));
  if( aliens.length ){
    throw new Error(util.format('in theta.json, parameter [%s] have to be deleted', missing.join(',')));
  }

  this.par_sv.concat(this.par_proc).forEach(function(p){
    var myp = that.theta.parameter[p];
    if( ('partition_id' in myp) && (myp.partition_id !== 'identical_population') && (myp.partition_id !== 'variable_population') ){      
      if(!(myp.partition_id in that.theta.partition)){
        throw new Error(util.format('in theta.json parameter %s, partition %s is not defined', p, myp.partition_id));
      } else if( !('population_id' in that.theta.partition[myp.partition_id].group[0])) {
        throw new Error(util.format('in theta.json parameter %s, partition %s, groups should contain a "population_id" property"', p, myp.partition_id));        
      }
    }   
  });

  this.par_obs.forEach(function(p){
    var myp = that.theta.parameter[p];
    if( ('partition_id' in myp) && (myp.partition_id !== 'identical_time_series') && (myp.partition_id !== 'variable_time_series') ){      
      if(!(myp.partition_id in that.theta.partition)){
        throw new Error(util.format('in theta.json parameter %s, partition %s is not defined', p, myp.partition_id));
      } else if( !('time_series_id' in that.theta.partition[myp.partition_id].group[0])) {
        throw new Error(util.format('in theta.json parameter %s, partition %s, groups should contain a "time_series_id" property"', p, myp.partition_id));
      }
    }   
  });
  

  this.par_sv.concat(this.par_proc, this.par_obs).forEach(function(p, i, allPar){
    var myp = that.theta.parameter[p];

    if('transformation' in myp){
      if(['log', 'logit', 'logit_ab', 'identity', 'scale_pow10', 'scale_pow10_neg', 'scale_pow10_bounded'].indexOf(myp.transformation) === -1){
        throw new Error(util.format('in theta.json parameter %s, unsuported transformation (%s)', p, myp.transformation));        
      }
    }

    if('unit' in myp){
      if(['D', 'W', 'M', 'Y'].indexOf(myp.unit) === -1){
        throw new Error(util.format('in theta.json parameter %s, unsuported unit (%s)', p, myp.unit));        
      }
    }

    if('type' in myp){
      if(['rate_as_duration'].indexOf(myp.type) === -1){
        throw new Error(util.format('in theta.json parameter %s, unsuported type (%s)', p, myp.type));        
      }
    }

    if('follow' in myp){
      if(allPar.indexOf(myp.follow) === -1){
        throw new Error(util.format('in theta.json parameter %s, follow is not a valid parameter (%s)', p, myp.follow));
      }
    }

    
    if( !('group' in myp) ){ //not expanded

      if( !('guess' in myp) ){
        throw new Error(util.format('in theta.json parameter %s, at least "guess" is required', p));                
      }
      
      ['guess', 'min', 'max', 'sd_transf'].forEach(function(x){
        if( (x in myp) && (typeof myp[x] !== 'number') ){
          throw new Error(util.format('in theta.json parameter %s, %s is not a number', p, x));
        }
      });

      if('prior' in myp){
        if(['normal', 'uniform'].indexOf(myp.prior) === -1){
          throw new Error(util.format('in theta.json parameter %s, unsuported prior (%s)', p, myp.prior));        
        }
      }
      
    } else { //expanded


      var mandatoryGroups;
      
      if(myp.partition_id === 'identical_population' || myp.partition_id === 'identical_time_series'){
        mandatoryGroups = ['all'];
      } else if(myp.partition_id === 'variable_population'){
        mandatoryGroups = that.context.population.map(function(x){return x.id;});
      } else if(myp.partition_id === 'variable_time_series'){
        mandatoryGroups = that.context.time_series.map(function(x){return x.id;});
      } else {
        mandatoryGroups = that.theta.partition[myp.partition_id].group.map(function(x){return x.id;});
      }
      
      var myGroups = Object.keys(myp.group);
      missing = _.difference(mandatoryGroups, myGroups);
      aliens = _.difference(myGroups, mandatoryGroups);

      if(missing.length){
        throw new Error(util.format('in theta.json parameter %s, missing group: [%s]', p, missing.join(',')));
      }        

      if(aliens.length){
        throw new Error(util.format('in theta.json parameter %s, invalid group (should be deleted): [%s]', p, aliens.join(',')));
      }

      
      myGroups.forEach(function(g){
        var myg = myp['group'][g];
        
        if( !('guess' in myg) ){
          throw new Error(util.format('in theta.json parameter %s group %s, at least "guess" is required', p, g));                
        }
        
        ['guess', 'min', 'max', 'sd_transf'].forEach(function(x){
          if(x in myg){
            if(!('value' in myg[x]) ){
              throw new Error(util.format('in theta.json parameter %s group %s property %s, value property is missing', p, g, x));
            }

            if(typeof myg[x]['value'] !== 'number'){
              throw new Error(util.format('in theta.json parameter %s group %s, %s.value is not a number', p, g, x));
            }
          }
        });

        if('prior' in myg){
          if(!('value' in myg.prior) ){
            throw new Error(util.format('in theta.json parameter %s group %s prior, value property is missing', p, g));
          }

          if(['normal', 'uniform'].indexOf(myg.prior.value) === -1){
            throw new Error(util.format('in theta.json parameter %s group %s, unsuported prior (%s)', p, g, myp.prior));
          }
        }
      });


    }

  });

  
}



Theta.prototype._validate_partition = function(){

  var popId = this.context.population.map(function(x){return x.id;})
    , tsId = this.context.time_series.map(function(x){return x.id;});  

  var type;
  
  for(var p in this.theta.partition){
    var myp = this.theta.partition[p];
    if(!Array.isArray(myp.group) || !myp.group.length){
      throw new Error(util.format('in theta.json partition: %s, group has to be a non empty list', p));
    }

    myp.group.forEach(function(g, i){
      var aliens;

      checkString(g, 'id', 'partition.' + p);
      if('time_series_id' in g){
        aliens = _.difference(g.time_series_id, tsId);
        if(aliens.length){
          throw new Error(util.format('in theta.json partition %s, group %s time_series_id contains invalid element: [%s]', p, g.id, aliens.join(',')));
        }        

        if(i === 0){
          type = 'time_series_id';
        } else if(type !== 'time_series_id'){
          throw new Error(util.format('in theta.json partition %s, mix of time_series_id and population_id properties'), p);
        }

      } else if ('population_id' in g){
        aliens = _.difference(g.population_id, popId);
        if(aliens.length){
          throw new Error(util.format('in theta.json partition %s, group %s population_id contains invalid element: [%s]', p, g.id, aliens.join(',')));
        }

        if(i === 0){
          type = 'population_id';
        } else if(type !== 'population_id'){
          throw new Error(util.format('in theta.json partition %s, mix of time_series_id and population_id properties'), p);
        }

      } else {
        throw new Error(util.format('in theta.json partition %s, group %s has to contain a population_id or time_series_id property', p, g.id));
      }

    });

  }

}




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

  if(options.trace || options.design){
    task.push(function(cb){that.plugTrace(options, cb);});
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
      try{
        that._set(options);
      } catch(e){
        return cb(e);
      }
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

    that._normalize();

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
 * parameter from the corresponding MCMC output (traceStream from
 * trace.csv).
 *
 * Note that the grouping of the initial condition of the generated
 * theta are set to variable_population
 */

Theta.prototype.predict = function(n, XStream, traceStream, options, callback){

  if(typeof(callback)==='undefined'){
    callback = options;
  };

  var that = this;

  //get states 
  var states = [];

  csv()
    .from.stream(XStream, {columns: true})
    .on('record', function(row){

      if(parseFloat(row.time, 10) === n){
        for(var key in row){
          row[key] = parseFloat(row[key]);
        }
        states.push(row);
      }

    })
    .on('end', function(){

      if(!states.length){
        return callback(new Error('predict: states could not be found for time: ' + n));
      }

      //get the parameter values
      var mkeep = states.map(function(x){return x.index;});
      var trace = [];

      csv()
        .from.stream(traceStream, {columns: true})
        .on('record', function(row, i){
          if(mkeep.indexOf(parseInt(row.index, 10)) !== -1){
            for(var key in row){
              row[key] = parseFloat(row[key]);
            }
            trace.push(row);
          }
        })
        .on('end', function(){

          if(!trace.length){
            return callback(new Error('predict: no line of best matching the states could not found'));
          }


          var thetas = []; 

          trace.forEach(function(mybest, i){
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

            thetas.push(that._addUngroupedStates(mytheta, states[i]));
            
          });

          callback(null, thetas);

        });
    });
};



/////////////////////////////////////////////////////
//low level methods
/////////////////////////////////////////////////////


Theta.prototype.plugTrace = function(options, callback){

  var that = this;

  var pathTrace;

  if(options.design){
    pathTrace = (typeof options.design === 'boolean') ? "design.csv" : options.design;
  } else {
    pathTrace = (typeof options.trace === 'boolean') ? "trace_0.csv" : options.trace;
  }


  pathTrace = path.resolve(options.root || '.', pathTrace);

  fs.exists(pathTrace, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('%s could not be found.', pathTrace)));
    }

    parse.obj_n(fs.createReadStream(pathTrace), {n: options.index_trace}, function(err, trace_n){
      if(err) return callback(err);
      reduce.merge(that.theta, trace_n, options);
      callback(null);      
    });

  });

};




Theta.prototype.plugHat = function(options, callback){
 
  var that = this;
  var pathHat = (typeof options.state === 'boolean') ? "hat_0.csv" : options.state;
  pathHat = path.resolve(options.root || '.', pathHat);

  var n = options.index_state;

  fs.exists(pathHat, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('%s could not be found, now quitting.', pathHat)));
    }

    parse.obj_n(fs.createReadStream(pathHat), {key: 'time', n:n}, function(err, hat_n){
      if(err) return callback(err);
      that._plugHat(hat_n, options);
      callback(null);
    });

  });

};


Theta.prototype.rescale = function(options, callback){

  var that = this;

  //resolve pathHat;
  var pathHat = "hat_0.csv"
  if(options.rescale.length === 1){
    if(options.state && (typeof options.state !== 'boolean')){
      pathHat = options.state
    }
  } else {
    pathHat = options.rescale[1];
  }
  pathHat = path.resolve(options.root || '.', pathHat);


  fs.exists(pathHat, function (exists) {
    if(! exists){ 
      return callback(new Error(util.format('%s could not be found, now quitting.', pathHat)));
    }

    parse.csvFloat(fs.createReadStream(pathHat), function(err, hat){
      if(err) return callback(err);
     

      that.load('data', function(err, data){        
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
  pathCov = path.resolve(options.root || '.', pathCov);

  fs.exists(pathCov, function(exists){

    if(!exists) return callback(new Error(util.format('%s could not be found.', pathCov)));

    parse.csvFloatArray(fs.createReadStream(pathCov), function(err, cov){
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
 * re-normalize check that sum of the initial conditions for one cac
 * is < 1 if not re-normalize by (sumSv + eps) with eps = 0.01 if no
 * remainder else 0 
 *
 * NOTE: the test for sumSv === 1 is needed as if there are no
 * remainder and sumSv is "exactly" 1.0, a simplex will never be able
 * to find a solution satisfying the constraint that sumSv<=1.0
 */

Theta.prototype._normalize = function(){

  var that = this;

  this.context.population.forEach(function(p){
    var sumSv = 0.0;

    //we create an hash (p2g) that map population_id -> group_id
    var p2g = {};

    that.process.state.forEach(function(x){
      if(x.id in that.theta.parameter){        
        p2g[x.id] = {};

        that.theta.partition[that.theta.parameter[x.id].partition_id]['group'].forEach(function(g){
          g.population_id.forEach(function(pop){
            p2g[x.id][pop] = g.id;
          });
        });

        sumSv += that.theta.parameter[x.id]['group'][p2g[x.id][p.id]]['guess']['value'];
      }
    });

    if(sumSv >= 1.0){
      var eps = (that.pop_size_eq_sum_sv) ? 0 : 0.01;

      if(!that.pop_size_eq_sum_sv || sumSv>1.0){
        that.emit('warning', util.format('sum of the state variable in proportion equals %d, renormalizing by %d', sumSv, sumSv+eps));
      }

      that.process.state.forEach(function(x){
        if(x.id in that.theta.parameter){        
          that.theta.parameter[x.id]['group'][p2g[x.id][p.id]]['guess']['value'] /= (sumSv + eps);
        }
      });                       
    }
    
  });
};




/**
 * Helper function
 * put states (hat_n object, with pop_size_n object) into theta (and ensure variable grouping)
 * !! this method do not modify this.theta (unless passed as an argument)
 */
Theta.prototype._addUngroupedStates = function(theta, hat_n){

  var that = this;

  var popSize = that._getPopSize_n(hat_n);

  var arrayify = function(obj, prop){
    var tab = [];
    for(var g in obj['group']) {tab.push(obj['group'][g][prop]['value'])};
    return tab;
  }

  var vgroup = theta.partition.variable_population.group;

  that.par_sv.forEach(function(par){

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
      this.emit('warning', util.format('all the prior for %s are not identical, setting them all to uniform\n', par));
      pprior = 'uniform'
    }

    par_object.group = {};
    
    vgroup.forEach(function(p) {      
      par_object.group[p.id] = {
        guess: {value: hat_n[par + ':' + p.id] / popSize[p.id]},
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
 */

Theta.prototype._plugHat = function(hat_n, options){

  var that = this;

  

  if(options.ungroup){
    that._addUngroupedStates(that.theta, hat_n);
  } else {
    
    ////////////////////////////////////////////////////////////
    //put states into theta (average states to respect grouping)
    ////////////////////////////////////////////////////////////

    var popSize = that._getPopSize_n(hat_n);
    
    this.par_sv.forEach(function(par) {
      var par_object = clone(that.theta.parameter[par]);

      //we create an hash (p2g) that map population_id -> group_id
      var p2g = {};

      var groups = that.theta.partition[par_object.partition_id]['group'];
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
        par_object['group'][p2g[p]]['guess']['value'] += hat_n[par + ':' + p] / popSize[p];
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

Theta.prototype._rescale = function(data, hat, options){

  var reporting = options.rescale[0];
  if(this.par_obs.indexOf(reporting) === -1){
    throw new Error(util.format('%s is not an observation process parameter, now quitting.', reporting));
  }

  var meanData = {}
    , meanHat = {}
    , n = 0;

  for(var ts in data){
    meanData[ts] = 0;
    meanHat[ts] = 0;

    n = 0;
    data[ts].value.forEach(function(x){
      if(x[1] !== null){
        meanData[ts] += x[1]; 
        n++;
      }
    });
    meanData[ts] /= n;

    n = 0;
    hat.forEach(function(x){
      if(x[ts] !== null){
        meanHat[ts] += x[ts]; 
        n++;
      }
    });
    meanHat[ts] /= n;
  }

  //first get the reporting parameter that equal the averages of data and hat assuming variable grp  
  var par_object = this.theta.parameter[reporting]
    , groups = this.theta.partition[par_object.partition_id]['group'];
  
  //we create a map that goes from ts -> group_id
  var ts2g = {};
  groups.forEach(function(g){
    g.time_series_id.forEach(function(ts){
      ts2g[ts] = g.id;
    });
  });
  
  //compute good reporting assuming variable grouping
  var good_reporting = {};
  for(var ts in data){
    good_reporting[ts] = meanData[ts] / (meanHat[ts] / par_object['group'][ts2g[ts]]['guess']['value']);    
  }  

  //average reporting so that it matches the grouping
  for(var g in par_object.group){
    par_object['group'][g]['guess']['value'] = 0.0;
  }
  for(var ts in data){
    par_object.group[ ts2g[ts] ]['guess']['value'] += good_reporting[ts];
  }

  groups.forEach(function(g){
    par_object['group'][g.id]['guess']['value'] /= g.time_series_id.length;
  });

  return this;
}


Theta.prototype._set = function(options){
  var that = this;

  options.set.forEach(function(parString){
    var parsed = parString.split(':');

    var par = parsed[0];
    var group, prop, val, groups;

    if(parsed.length === 3){
      prop = parsed[1];
      val = parsed[2];
    }else if (parsed.length === 4) {
      group = parsed[1];
      prop = parsed[2];
      val = (prop === 'prior') ? parsed[3] : parseFloat(parsed[3], 10);      
    } else {
      throw new Error(util.format('%s: invalid parString. valid parString are par:group:property:value (property being min, max, guess, sd_transf or prior) or par:transformation:value', parString));
    }

    if(prop=== 'prior'){
      if(that.prior.indexOf(val) === -1) {
        throw new Error(util.format('%s: %s is not a valid prior (valid priors are: %s)', parString, val, that.prior.join(', ')));
      }
    } else if (prop === 'transformation'){
      if(that.transformation.indexOf(val) === -1) {
        throw new Error(util.format('%s: %s is not a valid transformation (valid transformations are: %s)', parString, val, that.transformation.join(', ')));
      }
    }

    if(par in that.theta.parameter){

      if(prop === 'transformation'){
        that.theta.parameter[par]['transformation'] = val;
      } else {

        if(group === 'all'){
          groups = that.theta.partition[ that.theta.parameter[par]['partition_id'] ]['group'].map(function(x){return x.id;});
        } else {
          if (group in that.theta.parameter[par]['group']){
            groups = [group];
          } else {
            throw new Error(util.format('%s %s is not a valid group, now quitting.', parString, group));
          }
        }

        groups.forEach(function(group_id){
          if(prop in that.theta.parameter[par]['group'][group_id]){
            that.theta.parameter[par]['group'][group_id][prop]['value'] = val;
          } else {
            throw new Error(util.format('%s %s is not a valid property name.', parString, prop));
          }
        });

      }

    } else {
      throw new Error(util.format('%s %s is not a valid parameter name.', parString, par));
    }

  });

  return this;
};


/**
 * Moves guess from it's boundaries
 */

Theta.prototype._unstick = function(options){

  var mul = options.unstick || 0.0;
  if (mul < 0.0 || mul > 1.0) {
    this.emit('warning', util.format('invalid argument for -u, --unstick [p], p has to be in [0,1]. Setting %d to 0.0.', mul));
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
        this.emit('info', util.format('unsticked %s:%s (%d->%d)', par, group, x, this.theta.parameter[par]['group'][group]['guess']['value']));
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
    this.emit('warning', util.format('sanitized %s (log) %d -> %d\n', par_string, x, 0.0));
  } else if(transf === 'logit'){

    if(x<0.0){
      this.theta.parameter[par]['group'][group]['guess']['value'] = 0.0;
      this.emit('warning', util.format('sanitized %s (logit) %d -> %d\n', par_string, x, 0.0));
    }

    if(x>1.0){
      this.theta.parameter[par]['group'][group]['guess']['value'] = 1.0;
      this.emit('warning', util.format('sanitized %s (logit) %d -> %d\n', par_string, x, 1.0));
    }
  }

  if( (transf === 'logit_ab') || (transf === 'scale_pow_10_bounded') || (prior === 'uniform') ){
    //ensure that guess is within min and max
    x = this.theta.parameter[par]['group'][group]['guess']['value'];

    if(x < this.theta.parameter[par]['group'][group]['min']['value']){
      par_string = [par, group, 'min'].join(':');
      this.emit('warning', util.format('sanitized %s %d (guess) -> %d (min)', par_string, x, this.theta.parameter[par]['group'][group]['min']['value']));
      this.theta.parameter[par]['group'][group]['guess']['value'] = this.theta.parameter[par]['group'][group]['min']['value'];
    }

    if(x > this.theta.parameter[par]['group'][group]['max']['value']){
      par_string = [par, group, 'max'].join(':');
      this.emit('warning', util.format('sanitized %s %d (guess) -> %d (max)', par_string, x, this.theta.parameter[par]['group'][group]['max']['value']));
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

  //par_proc and par_obs default to 'log'
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
