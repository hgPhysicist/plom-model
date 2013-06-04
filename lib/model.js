var _ = require('underscore')
  , clone = require('clone')
  , Context = require('./context');

/**
 * Extend Context
 */
function Model(context, process, link){

  Context.call(this, context);

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

};

 
Model.prototype.getPopSize_n = function(pop_size, hat_n, n){
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





module.exports = Model;
