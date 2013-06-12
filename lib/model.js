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
  var states = [];
  this.process.state.forEach(function(x){
    states.push(x.id);
  }); // it also contains remainder, as opposed to sv.

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
      if (op.indexOf(r)==-1 && states.indexOf(r)==-1 && proc.indexOf(r)==-1 && proc.indexOf(r)==-1 && proc.indexOf(r)==-1 && proc.indexOf(r)==-1 && obs.indexOf(r)==-1 && meta.indexOf(r)==-1 && r!='correct_rate' && !(IsNumeric(r))){
	throw new Error(util.format('In reaction rates, the term %s cannot be interpreted.', r));
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
