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

  this.pop_size_eq_sum_sv = true;
  for(var i=0; i< process.model.length; i++){
    if(process.model[i].from === 'DU' || process.model[i].to === 'DU'){
      this.pop_size_eq_sum_sv = false;
      break;
    }
  }

};

Model.prototype = Object.create(Context.prototype);
Model.prototype.constructor = Model;



/**
 * Validate model
 */

Model.prototype.validate = function(){

};


Model.prototype.getPopSize = function(hat_n, n, callback){
  var that = this;

  that.load('metadata', 'N', function(err, pop_size){
    if (err) return callback(err);

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

      nSafe =  (n < pop_size.length ) ? n+1 : pop_size.length-1; //!!!hat can be longer that pop_size
      pop_size[0].forEach(function(pop, i){
        pop_size_n[pop] = pop_size[nSafe][i];
      });

    }

    callback(null, pop_size_n);
    
  });

};





module.exports = Model;
