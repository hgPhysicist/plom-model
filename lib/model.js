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

  //remove par_fixed
  if(this.context.metadata){
    this.par_proc = _.difference(this.par_proc, this.context.metadata.map(function(x) {return x.id}));
  }

  if(this.context.data){
    this.par_obs = _.difference(this.par_obs, this.context.data.map(function(x) {return x.id}));
  }

};

Model.prototype = Object.create(Context.prototype);
Model.prototype.constructor = Model;



/**
 * Validate model
 */

Model.prototype.validate = function(){
  var sv=this.par_sv;
  var proc=this.par_proc;
  var obs=this.par_obs;
  var meta = [];
  this.context.metadata.forEach(function(x){
    meta.push(x.id);
  });
  var data = [];
  this.context.data.forEach(function(x){
    if (x.id !== 'data'){
      data.push(x.id);
    };
  });
  var states = [];
  this.process.state.forEach(function(x){
    states.push(x.id);
  }); // it also contains remainder, as opposed to sv.
  var reactions = [];
  this.process.model.forEach(function(s){
    reactions.push(s);
  });
  var exprsPLOM = ['t','ONE_YEAR'];
  var funcsPLOM = ['terms_forcing','step','step_lin','sin','cos','tan','correct_rate'];

  /// Validating process
 // Check that all fields are there, and that  there are no extras:
  var requiredFields = ['name','description','state', 'parameter', 'model'];
  var optionalFields = ['white_noise', 'diffusion'];
  var processFields = [];
  for(var s in this.process){
    processFields.push(s);
  }; 
  requiredFields.forEach(function(s){
    if (processFields.indexOf(s)==-1){
      throw new Error(util.format('A "%s" field is missing in the process.json file',s));
    };
  });
  processFields.forEach(function(s){
    if (requiredFields.indexOf(s)==-1 && optionalFields.indexOf(s)==-1){
      throw new Error(util.format('Sorry, but the field %s in process.json does not belong to the PLOM syntax.',s));
    };
  });


  // Testing if "from" and "to" are proper state variables
  this.process.model.forEach(function(s){
    if (states.indexOf(s.from) == -1 && s.from != 'U'){
      throw new Error(util.format('%s is not a state variable, it cannot serve as source for a reaction.', s.from));
    }
  });
  this.process.model.forEach(function(s){
    if (states.indexOf(s.to) == -1 && s.to != 'U'){
      throw new Error(util.format('%s is not a state variable, it cannot serve as a sink for a reaction.', s.to));
    }
  });

  // Testing if rates do not involve unknown terms
  this.process.model.forEach(function(s){
    parseRate(s.rate).forEach(function(r){
      if (op.indexOf(r)==-1 && states.indexOf(r)==-1 && proc.indexOf(r)==-1 && meta.indexOf(r)==-1 && data.indexOf(r)==-1 && funcsPLOM.indexOf(r)==-1 && isNaN(r) && r.indexOf('M_') == -1 && r.indexOf('GSL_') == -1 && exprsPLOM.indexOf(r)==-1 ){
	throw new Error(util.format('In reaction rates, the term %s cannot be interpreted.', r));
      }
    });
  });
  
  // Testing if white noise is defined on existing reaction with existing parameter
  if(this.process.white_noise){
    this.process.white_noise.forEach(function(s){
      var correspondingReactions = 0;
      s.reaction.forEach(function(r){
	//console.log(r);
	reactions.forEach(function(u){
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
	    throw new Error(util.format('The reaction going from %s to %s with rate %, with white noise, has not been defined in process.json.',r.from, r.to, r.rate));
	  } else {
	    throw new Error(util.format('The reaction going from %s to %s, with white noise, has not been defined in process.json.',r.from, r.to));
	  };
	} else if (correspondingReactions > 1){
	  throw new Error(util.format('There are several reactions going from %s to %s. Please specify the rate so that no confusion is possible when applying the white noise.',r.from, r.to));
	};
      });
    });
  };

  // Testing if diffusions are defined on existing parameters, with zero drift and volatility determined by single parameter
  if(this.process.diffusion){
    this.process.diffusion.forEach(function(s){
      if ( proc.indexOf(s.parameter)==-1 && obs.indexOf(s.parameter)==-1){
	throw new Error(util.format('In "diffusions", %s has not been defined as a parameter.',s.parameter));
      }
    });

    this.process.diffusion.forEach(function(s){
      if ( s.drift !=0 ){
	throw new Error(util.format('We are sorry, but non-zero drifts for time-varying parameters are not yet supported.',s.parameter));
      }
    });
    
    this.process.diffusion.forEach(function(s){
      if ( proc.indexOf(s.volatility)==-1 ){
	throw new Error(util.format('We are sorry, but for the moment volatilities have to be (potentially fixed) process parameters',s.parameter));
      }
    });
  };

  /// Validating link
  // Check that all fields are there, and that  there are no extras:
  var requiredFields = ['name', 'description', 'observed', 'observation'];
  var linkFields = [];
  for(var s in this.link){
    linkFields.push(s);
  }; 
  requiredFields.forEach(function(s){
    if (linkFields.indexOf(s)==-1){
      throw new Error(util.format('A "%s" field is missing in the link.json file.',s));
    };
  });
  linkFields.forEach(function(s){
    if (requiredFields.indexOf(s)==-1){
      throw new Error(util.format('Sorry, but the field %s in link.json does not belong to the PLOM syntax.',s));
    };
  });

  this.link.observed.forEach(function(s){
    s.definition.forEach(function(r){

      var obsType= '';
      if(typeof r === 'string'){
	if(obsType === 'inc' || obsType !== ''){
	  throw new Error('There is a problem in the definition of the observed variables: incidence and prevalence cannot be summed up.');
	};
	obsType = 'prev';
	if  (states.indexOf(r)==-1){
	  throw new Error(util.format('State %s cannot be observed, it has not be defined as a state variable.',r));
	};
      } else {
	if(obsType === 'prev' || obsType !== ''){
	  throw new Error('There is a problem in the definition of the observed variables: incidence and prevalence cannot be summed up.');
	};
	obsType = 'inc';
	if  (states.indexOf(r.from)==-1 && r.from != 'U' ){
	  throw new Error(util.format('Incidence relative to state %s cannot be observed, it has not be defined as a state variable.',r.from));
	};
	if  (states.indexOf(r.to)==-1 && r.to != 'U' ){
	  throw new Error(util.format('Incidence relative to state %s cannot be observed, it has not be defined as a state variable.',r.to));
	};

	var correspondingReactions = 0;
	reactions.forEach(function(u){
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
  
  this.link.observation.forEach(function(s){
    if (s.model.distribution !== 'discretized_normal'){
      throw new Error('We are sorry, but only discretized_normal observation distribution is supported for the moment.');
    };
    parseRate(s.model.mean).forEach(function(r){
      if (op.indexOf(r)==-1 && obs.indexOf(r)==-1 && meta.indexOf(r)==-1 && data.indexOf(r)==-1  && r !== 'x' && isNaN(r) && r.indexOf('M_') == -1 && r.indexOf('GSL_') == -1 && funcsPLOM.indexOf(r)==-1 && exprsPLOM.indexOf(r)==-1 ){
	throw new Error(util.format('In the observation model, the term %s cannot be interpreted.', r));
      }
    });
    parseRate(s.model.var).forEach(function(r){
      if (op.indexOf(r)==-1 && obs.indexOf(r)==-1 && meta.indexOf(r)==-1 && data.indexOf(r)==-1 && r !== 'x' && isNaN(r) && r.indexOf('M_') == -1 && r.indexOf('GSL_') == -1 && funcsPLOM.indexOf(r)==-1 && exprsPLOM.indexOf(r)==-1 ){
	throw new Error(util.format('In the observation model, the term %s cannot be interpreted.', r));
      }
    });
  });

};

 
Model.prototype._getPopSize_n = function(pop_size, hat_n, n){
  var that = this;

  var pop_size_n = {}
    , nSafe;
  
  if(that.pop_size_eq_sum_sv){

    that.context.population.forEach(function(p){
      var sum_sv = 0.0;
      that.par_sv.forEach(function(s){
        sum_sv += hat_n[s + ':'  + p.id];              
      });
      pop_size_n[p.id] = sum_sv;
    });

  } else {

    nSafe =  (n < pop_size.length ) ? n+1 : pop_size.length-1; //!!!n can be longer that pop_size
    pop_size[0].forEach(function(pop, i){
      pop_size_n[pop] = pop_size[nSafe][i];
    });

  }

  return pop_size_n
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

var op = ['+', '-', '*', '/', ',', '(', ')'];

function parseRate (rate){

  rate = rate.replace(/\s+/g, '');

  var s = ''
    , l = [];

  for (var i = 0; i< rate.length; i++){
    if (op.indexOf(rate[i]) !== -1){
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


module.exports = Model;
