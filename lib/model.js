var _ = require('underscore')
  , Context = require('./context');

/**
 * Extend Context
 */
function Model(context, process, link){

  Context.call(this, context);

  this.process = process;
  this.link = link;

  this.par_sv = this.process.state.map(function(x) {return x.id});
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


module.exports = Model;
