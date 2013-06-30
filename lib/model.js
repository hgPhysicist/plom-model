var _ = require('underscore')
  , clone = require('clone')
  , Context = require('./context')
  , util = require('util');

/**
 * Extend Context
 */
function Model(context, process, link, options){

  Context.call(this, context, options);
  
  this.transformation = ['identity', 'log', 'logit', 'logit_ab', 'scale_pow10', 'scale_pow10_bounded', 'scale_pow10_neg'];
  this.prior = ['uniform', 'normal'];

  this.process = clone(process);
  this.link = clone(link);

  this.par_sv = this.process.state
    .filter(function(x){return !('tag' in x) || (typeof x.tag === 'string' &&  x.tag !== 'remainder') || (Array.isArray(x.tag) && x.tag.indexOf('remainder') === -1) })
    .map(function(x) {return x.id});

  this.pop_size_eq_sum_sv = (this.par_sv.length === this.process.state.length);

  this.par_proc = this.process.parameter.map(function(x) {return x.id});
  this.par_obs = this.link.observation[0].parameter.map(function(x) {return x.id});

  this.par_meta = this.context.metadata.map(function(x) {return x.id});

  //remove par_fixed
  if(this.context.metadata){
    this.par_proc = _.difference(this.par_proc, this.par_meta);
  }

  if(this.context.data){
    this.par_obs = _.difference(this.par_obs, this.par_meta);
  }

  this.op = ['+', '-', '*', '/', ',', '(', ')'];
};

Model.prototype = Object.create(Context.prototype);
Model.prototype.constructor = Model;


/**
 * Validate model
 */

Model.prototype.validate = function(){

  Context.prototype.validate.call(this);

  var that = this;

  var states = this.process.state.map(function(x) {return x.id}) //also contains remainder as opposed to sv  
    , exprsPLOM = ['t','ONE_YEAR']
    , funcsPLOM = ['terms_forcing','step','step_lin','sin','cos','tan','correct_rate'];


  //helper functions
  function checkString(obj, key, type){    
    if(key in obj){ //usefull for optional keys
      if(typeof obj[key] !== 'string'){
        throw new Error(util.format('in %s.json, "%s" has to be a string', type, key));
      }
    }   
  }

  function checkArray(obj, key, type){
    if(key in obj){ 
      if(!Array.isArray(obj[key])){
        throw new Error(util.format('in %s.json, "%s" has to be a list', type, key));
      } else if (! obj[key].length) {
        throw new Error(util.format('in %s.json in "%s" can not be empty', type, key));
      }
    }
  }

  /// Validating process
  // Check that all fields are there, extra field are OK (and will be added by the webApp pour raise a warning for the CLI)
  var requiredFields = ['name','description','state', 'parameter', 'model'];
  var optionalFields = ['white_noise', 'diffusion'];

  requiredFields.forEach(function(s){
    if (! s in that.process){
      throw new Error(util.format('A "%s" field is missing in the process.json file', s));
    };
  });

  for(var s in this.process){  
    if (! s in that.process && optionalFields.indexOf(s) === -1){
      that.emit('warning', util.format('the field %s in process.json does not belong to the PLOM syntax.',s));
    };
  };

  checkString(this.process, 'name', 'process');
  checkString(this.process, 'description', 'process');
  ['state', 'parameter', 'model', 'white_noise', 'diffusion'].forEach(function(key){
    checkArray(that.process, key, 'process');
  });

  //check state
  this.process.state.forEach(function(obj, i){
    if(Object.prototype.toString.call(obj) !== '[object Object]'){
      throw new Error(util.format('in process.json, state (%d), state variable must be defined as a list of **objects**', i));      
    }

    if(! 'id' in obj){
      throw new Error(util.format('in process.json, state, state (%d) "id" is missing', i));
    }

    //check state tags:
    if('tag' in obj){ 
      if(!Array.isArray(obj.tag)){
        throw new Error(util.format('in process.json, state: "%s" tag has to be a list (%s)', s.id, s.tag));
      } else if (! obj.tag.length) {
        throw new Error(util.format('in process.json, state: "%s" tag can not be empty (%s)', s.id));
      } else if ( (_.difference(obj.tag, ['infectious', 'remainder'])).length ) {
        throw new Error(util.format('in process.json, state: "%s" invalid tag (%s)', _.difference(obj.tag, ['infectious', 'remainder'])));
      }
    }
  });

  //check parameter
  this.process.parameter.forEach(function(obj, i){
    if(Object.prototype.toString.call(obj) !== '[object Object]'){
      throw new Error(util.format('in process.json, parameter (%d), parameter must be defined as a list of **objects**', i));      
    }

    if(! 'id' in obj){
      throw new Error(util.format('in process.json, parameter, parameter (%d) "id" is missing', i));
    }
  });


  //check process model
  var allowedPrate = this.op.concat(states, that.par_proc, that.par_meta, funcsPLOM, exprsPLOM); //terms allowed in rates of the process model

  this.process.model.forEach(function(s, i){
    if(Object.prototype.toString.call(s) !== '[object Object]'){
      throw new Error(util.format('in process.json, model (%d), reactions must be defined as a list of **objects**', i));      
    }

    //testing that from, to and rate are present    
    if( (_.difference(['from', 'to', 'rate'], Object.keys(s))).length ){
      throw new Error(util.format('in process.json, model (%d), reactions must have a %s property', (_.difference(['from', 'to', 'rate'], Object.keys(s))).join(', ')));            
    }

    //check tag
    if('tag' in s){ 
      if(!Array.isArray(s.tag)){
        throw new Error(util.format('in process.json, model : reaction number %d: tag has to be a list', i));
      } else if (! s.tag.length) {
        throw new Error(util.format('in process.json, reaction number %d: tag can not be empty', i));
      } else if ( (_.difference(s.tag, ['transmission'])).length ) {
        throw new Error(util.format('in process.json, reaction number "%d" invalid tag (%s)', i, _.difference(s.tag, ['transmission'])));
      }
    }

    // Testing if "from" and "to" are proper state variables
    if (states.indexOf(s.from) === -1 && s.from !== 'U'){
      throw new Error(util.format('%s is not a state variable, it cannot serve as source for a reaction.', s.from));
    }
    if (states.indexOf(s.to) == -1 && s.to != 'U'){
      throw new Error(util.format('%s is not a state variable, it cannot serve as a sink for a reaction.', s.to));
    }

    // Testing if rates do not involve unknown terms
    that.parseRate(s.rate).forEach(function(r){
      if (allowedPrate.indexOf(r) === -1 && isNaN(r) && r.indexOf('M_') === -1 && r.indexOf('GSL_') === -1){
	throw new Error(util.format('In reaction rates, the term %s cannot be interpreted.', r));
      }
    });

  });
  


  if(this.process.white_noise){



    this.process.white_noise.forEach(function(obj,i){

      //testing that reaction and sd are present    
      if( (_.difference(['reaction', 'sd'], Object.keys(obj))).length ){
	throw new Error(util.format('in process.json, white noise %d, reactions must have a %s property', (_.difference(['reaction', 'sd'], Object.keys(s))).join(', ')));            
      }

      if(Object.prototype.toString.call(obj) !== '[object Object]'){
	throw new Error(util.format('in process.json, white noise %d must be defined as a list of **objects**', i)); 
      }


      if(!Array.isArray(obj.reaction)){
        throw new Error(util.format('in process.json, white noise %d, the field "reaction" has to be a list',i));
      } else if (! obj.reaction.length) {
        throw new Error(util.format('in process.json, white noise %d, the field "reaction" can not be empty'));
      }

    });

    // Testing if white noise is defined on existing reaction with existing parameter
    this.process.white_noise.forEach(function(s,i){
      
     
      s.reaction.forEach(function(r,j){

	var correspondingReactions = 0;
	if(! 'to' in r){
	  throw new Error(util.format('in process.json, white noise %d, reaction %d, field "to" needs to be defined for each source of noise.', i,j));
	}
	if(! 'from' in r){
	  throw new Error(util.format('in process.json, white noise %d, reaction %d, field "from" needs to be defined for each source of noise.', i,j));
	}

	that.process.model.forEach(function(u){
	  if (r.to === u.to && r.from === u.from){
	    if (r.rate){
	      if( r.rate === u.rate ){
		correspondingReactions += 1;
	      };
	    } else {
	      correspondingReactions += 1;
	    };
	  };
	});
	if(correspondingReactions == 0){
	  if (r.rate){
	    throw new Error(util.format('The reaction going from %s to %s with rate %, with white noise, has not been defined in the model of process.json.',r.from, r.to, r.rate));
	  } else {
	    throw new Error(util.format('The reaction going from %s to %s, with white noise, has not been defined in the model of process.json.',r.from, r.to));
	  };
	} else if (correspondingReactions > 1){
	  throw new Error(util.format('There are severalll reactions going from %s to %s. Please specify the rate so that no confusion is possible when applying the white noise.',r.from, r.to));
	};
      });
    });
  };


  // Testing if diffusions are defined on existing parameters, with zero drift and volatility determined by single parameter
  if(this.process.diffusion){
    this.process.diffusion.forEach(function(obj,i){

      //testing that reaction and sd are present    
      if( (_.difference(['parameter', 'drift', 'volatility'], Object.keys(obj))).length ){
	throw new Error(util.format('in process.json, white noise %d, reactions must have a %s property', (_.difference(['parameter', 'drift','volatility'], Object.keys(s))).join(', ')));            
      }

      checkString(obj, 'parameter', 'process');
      checkString(obj, 'volatility', 'process');

      if ( that.par_proc.indexOf(obj.parameter) === -1 && that.par_obs.indexOf(obj.parameter) === -1){
	throw new Error(util.format('In "diffusions", %s has not been defined as a parameter.',s.parameter));
      }

      if ( obj.drift != 0 ){
	throw new Error(util.format('We are sorry, but non-zero drifts for time-varying parameters are not yet supported.',s.parameter));
      }

      if ( that.par_proc.indexOf(obj.volatility) === -1 ){
	throw new Error(util.format('We are sorry, but for the moment volatilities have to be (potentially fixed) process parameters', s.parameter));
      }
    });
  };


  /// Validating link
  // Check that all fields are there, if there are extra field, emit a warning (the db can add extra field but for CLI the user should not:
  requiredFields = ['name', 'description', 'observed', 'observation'];
  
  requiredFields.forEach(function(s){
    if (! s in that.link){
      throw new Error(util.format('A "%s" field is missing in the link.json file.', s));
    };
  });
  for(var s in this.link){
    if (requiredFields.indexOf(s) === -1){
      that.emit('warning', util.format('The field %s in link.json does not belong to the PLOM syntax.', s));
    };
  };


  checkString(this.link, 'name', 'link');
  checkString(this.link, 'description', 'link');
  ['observed', 'observation'].forEach(function(key){
    checkArray(that.link, key, 'link');
  });



  this.link.observed.forEach(function(s, i){

    if(Object.prototype.toString.call(s) !== '[object Object]'){
      throw new Error(util.format('in link.json observed, must be defined as a list of **objects** (%d)', i));
    }

    var missignKeys = _.difference(['id', 'definition', 'time_series_id', 'observation_id'], Object.keys(s));
    if ( missignKeys.length ) {
      throw new Error(util.format("in link.json observed: %s are mandatory properties of an observed object", missignKeys.join(', ')));
    }
 
    //test that time_series_id are all defined in context.json        
    if(!Array.isArray(s.time_series_id)){
      throw new Error(util.format('in link.json, observed "%d" time_series_id has to be a list', i));
    } else if (! s.time_series_id.length) {
      throw new Error(util.format('in link.json, observed: "%d" time_series_id can not be empty', i));
    } else {      
      var tsNotInContext = _.difference(s.time_series_id, that.context.time_series.map(function(x){return x.id;}));
      if(tsNotInContext.length){
        throw new Error(util.format("in link.json observed: %d the following time_series are not defined in context.json %s", i, tsNotInContext.join(', ')));
      }

      //check that all the time series are of the same type (incidence or prevalence)      
      if(! s.time_series_id.every(function isSameType(el, j, array){return el.split('__')[2] === array[0].split('__')[2];})){
        throw new Error(util.format("in link.json observed: %d the time_series_id contains both incidence and prevalences", i));      
      }
    }

    var obsType = s.time_series_id[0].split('__')[2];

    //check that definition is a non empty Array
    if(!Array.isArray(s.definition)){
      throw new Error(util.format('in link.json, observed "%d" definition has to be a list', i));
    } else if (! s.definition.length) {
      throw new Error(util.format('in link.json, observed: "%d" definition can not be empty', i));
    } 

    //check that all the definition are of same type
    if(! s.definition.every(function isSameType(el, j, array){return typeof el === typeof array[0];})){
      throw new Error(util.format("in link.json observed: %d the definition contains both incidence and prevalences", i)); 
    }

    //check that the type is compatible with obsType
    if(obsType === 'prev' && typeof s.definition[0] !== 'string'){
      throw new Error(util.format("in link.json observed: %d a prevalence should be defined by a list of state variable strings", i)); 
    }

    if(obsType === 'inc' && Object.prototype.toString.call(s.definition[0]) !== '[object Object]'){
      throw new Error(util.format("in link.json observed: %d a prevalence should be defined by a list of objects", i)); 
    }

    s.definition.forEach(function(r){
         
      if(obsType === 'prev'){
	if  (states.indexOf(r)==-1){
	  throw new Error(util.format('State %s cannot be observed, it has not be defined as a state variable.',r));
	};
      } else { //incicince

	if(states.indexOf(r.from)==-1 && r.from != 'U' ){
	  throw new Error(util.format('Incidence relative to state %s cannot be observed, it has not be defined as a state variable.',r.from));
	};
	if(states.indexOf(r.to)==-1 && r.to != 'U' ){
	  throw new Error(util.format('Incidence relative to state %s cannot be observed, it has not be defined as a state variable.',r.to));
	};

	var correspondingReactions = 0;
	that.process.model.forEach(function(u){
	  if (r.to === u.to && r.from === u.from){
	    if (r.rate){
	      if( r.rate == u.rate ){
		correspondingReactions += 1;
	      };
	    } else {
	      correspondingReactions += 1;
	    };
	  };
	});
	if(correspondingReactions == 0){
	  if (r.rate){
	    throw new Error(util.format('The observed reaction going from %s to %s with rate %s has not been defined in process.json.',r.to, r.from, r.rate));
	  } else {
	    throw new Error(util.format('The observed reaction going from %s to %s has not been defined in process.json.',r.to, r.from));
	  };
	} else if (correspondingReactions > 1){
	  throw new Error(util.format('There are several reactions going from %s to %s. Please specify the rate so that no confusion is possible.',r.to, r.from));
	};
      };
    });


  });


  var allowedOrate = this.op.concat(states, that.par_obs, that.par_meta, funcsPLOM, exprsPLOM); //terms allowed in rates of the observtion model
  this.link.observation.forEach(function(s){
    if (s.model.distribution !== 'discretized_normal'){
      throw new Error('We are sorry, but only discretized_normal observation distribution is supported for the moment.');
    };
    that.parseRate(s.model.mean).forEach(function(r){
      if (allowedOrate.indexOf(r)==-1 && r !== 'x' && isNaN(r) && r.indexOf('M_') == -1 && r.indexOf('GSL_') == -1){
	throw new Error(util.format('In the observation model, the term %s cannot be interpreted.', r));
      }
    });
    that.parseRate(s.model['var']).forEach(function(r){
      if (allowedOrate.indexOf(r)==-1 && r !== 'x' && isNaN(r) && r.indexOf('M_') == -1 && r.indexOf('GSL_') == -1){
	throw new Error(util.format('In the observation model, the term %s cannot be interpreted.', r));
      }
    });
  });

  this._checkMetadata();

};


/**
 * !! Metadata are validated only if they were previously
 * parsed (always the case for the webApp)
 */
Model.prototype._checkMetadata = function() {
  var that = this;

  var pproc = this.process.parameter.map(function(x){return x.id;}) //parameter of the process model (including the forced one)
    , pobs = this.link.observation[0].parameter.map(function(x) {return x.id}) //parameter of the observations model (including the forced one)
    , popId = this.context.population.map(function(x){return x.id;})
    , tsId = this.context.time_series.map(function(x){return x.id;});  

  var missing, aliens, mandatory;
  var dateMin, dateMax;
  var myt0, mytend;
  
  if(('source' in this.context.data) && (typeof this.context.data.source !== 'string') ){ //data have been parsed, we check

    dateMin = new Date(this.context.data.source[tsId[0]].t0);
    dateMax = new Date(this.context.data.source[tsId[0]].value[this.context.data.source[tsId[0]].value.length-1][0]);

    for(var ts in this.context.data.source){
      myt0 = new Date(this.context.data.source[ts].t0);
      mytend = new Date(this.context.data.source[ts].value[this.context.data.source[ts].value.length-1][0]);

      if(myt0 < dateMin){
        dateMin = myt0;
      }
      if(mytend > dateMax){
        dateMax = mytend;
      }
    }
    
  } else {    
      throw new Error('in context.json data are missing');
  }

  this.context.metadata.forEach(function(m){

    if(('source' in m) && (typeof m.source !== 'string') ){ //data have been parsed, we check      
      if(pproc.indexOf(m.id) !== -1){
        mandatory = popId;                
      } else if (pobs.indexOf(m.id) !== -1){
        mandatory = tsId;
      } else {
        that.emit('warning', 'metadata ' + m.id + 'do not correspond to any process or observation model parameters and will be ignored');
        mandatory = undefined;
      }

      if(mandatory){        
        missing = _.difference(Object.keys(m.source), mandatory);
        aliens = _.difference(mandatory, Object.keys(m.source));

        if(missing.length){
          throw new Error(util.format('in context.json, metadata (%s) ; [%s] are missing', m.id, missing.join(', ')));
        }

        if(aliens.length){
          throw new Error(util.format('in context.json, metadata (%s) ; [%s] are not in [%s]', m.id, alien.join(', '), mandatory.join(', ')));
        }

        //check that the metadata cover the whole time range
        for(var s in m.source){
          myt0 = new Date(m.source[s].value[0][0]);
          mytend = new Date(m.source[s].value[m.source[s].value.length -1][0]);
          
          if(myt0 > dateMin){
            throw new Error(util.format('in context.json, metadata "%s" (%s), the first point (%s) has to be before data.t0 (%s)', m.id, s,  myt0, dateMin));
          }
          if(mytend < dateMax){
            throw new Error(util.format('in context.json, metadata "%s" (%s), the last point (%s) has to be after the last data point (%s)', m.id, s, mytend, dateMax));
          }
        }        
      }
    } else {
      throw new Error(util.format('in context.json metadata %s are missing', m.id));
    }

  });
  
};



/**
 * Return a copy of the model data for JSON stringification. The
 * name of this method is a bit confusing, as it doesn't actually
 * return a JSON string — but I'm afraid that it's the way that the
 * JavaScript API for JSON.stringify works
 */
Model.prototype.toJSON = function() {
  return clone({context: this.context, process: this.process, link: this.link});
};


/**
 * Transform the rate into an array:
 *
 * example: 'r0*2*correct_rate(v)' ->
 * ['r0', '*', '2', 'correct_rate', '(', 'v', ')']
 */

Model.prototype.parseRate = function (rate){

  rate = rate.replace(/\s+/g, '');

  var s = ''
    , l = [];

  for (var i = 0; i< rate.length; i++){
    if (this.op.indexOf(rate[i]) !== -1){
      if(s.length){
        l.push(s);
        s = '';
      }
      l.push(rate[i]);
    } else {
      s += rate[i];
    }

  }

  if (s.length){
    l.push(s);
  }

  return l;
}


/**
 * hat_X_n an object from a line of hat_.csv or X.csv
 */
Model.prototype._getPopSize_n = function(hat_X_n){
  var that = this;

  var popSize = {};
  that.context.population.forEach(function(p){
    popSize[p.id] = 0.0;
    that.process.state.forEach(function(s){ //includes remainder
      popSize[p.id] += hat_X_n[s.id + ':' + p.id];
    });
  });

  return popSize
};




module.exports = Model;
