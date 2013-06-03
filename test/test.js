var Context = require('..').Context
  , Model = require('..').Model
  , path = require('path')
  , Theta = require('..').Theta
  , fs = require('fs')
  , assert = require('assert');


var root = path.dirname(__filename);

describe('context', function(){

  var context;

  beforeEach(function(){
    context = new Context(require(path.join(root, 'context.json'))); 
  });

  it('should parse data synchronously', function(){
    context.parseDataSync(root);
    assert.deepEqual(context.context, require(path.join(root, 'expected', 'context.json')));
  });

  it('should parse data asynchronosly', function(done){
    context.parseData(root, function(err){
      assert.deepEqual(context.context, require(path.join(root, 'expected', 'context.json')));
      done();
    });
  });
  
  it('should load data', function(done){
    context.load('data', 'data', root, function(err, data){
      assert.deepEqual(data, require(path.join(root, 'expected', 'context.json')).data.filter(function(x){return x.id==='data'})[0].source);
      done();
    });
  });

  it('should load metadata', function(done){
    context.load('metadata', 'mu_b', root, function(err, data){
      assert.deepEqual(data, require(path.join(root, 'expected', 'context.json')).metadata.filter(function(x){return x.id==='mu_b'})[0].source);
      done();
    });
  });

});


describe('model', function(){

  var model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')));

  it('should have par_sv', function(){
    assert.deepEqual(model.par_sv, ['S', 'I']);
  });

  it('should have par_proc', function(){
    assert.deepEqual(model.par_proc, ['r0', 'v', 'sto']);
  });

  it('should have par_obs', function(){
    assert.deepEqual(model.par_obs, ['rep', 'phi']);
  });

  it('should not have pop_size_eq_sum_sv', function(){
    assert(!model.pop_size_eq_sum_sv);
  })

});







describe('theta', function(){

  var theta;

  beforeEach(function(){
    theta = new Theta(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')), require(path.join(root, 'theta.json'))); 
  });


  it('should adapt theta', function(){
    theta.adapt();
    assert.deepEqual(theta.theta, require(path.join(root, 'expected', 'theta.json')));
  });


  it('should set theta', function(done){
    theta.adapt();
    theta.mutate({
      set: ['r0:city1__all:min:6',
            'r0:city2__all:min:7',
            'r0:city1__all:guess:16',
            'r0:city2__all:guess:17',
            'r0:city1__all:max:46',
            'r0:city2__all:max:47',
            'r0:city1__all:sd_transf:0.06',
            'r0:city2__all:sd_transf:0.07',
           ]
    }, function(err){

      assert.equal(theta.theta.parameter.r0.group.city1__all.min.value, 6);
      assert.equal(theta.theta.parameter.r0.group.city2__all.min.value, 7);

      assert.equal(theta.theta.parameter.r0.group.city1__all.guess.value, 16);
      assert.equal(theta.theta.parameter.r0.group.city2__all.guess.value, 17);

      assert.equal(theta.theta.parameter.r0.group.city1__all.max.value, 46);
      assert.equal(theta.theta.parameter.r0.group.city2__all.max.value, 47);

      assert.equal(theta.theta.parameter.r0.group.city1__all.sd_transf.value, 0.06);
      assert.equal(theta.theta.parameter.r0.group.city2__all.sd_transf.value, 0.07);

      done();
    });

  });


  it('should be sanitized', function(done){
    theta.adapt();
    theta.mutate({
      set: ['r0:all:max:51', 'r0:all:guess:600']
    }, function(err){

      assert.equal(theta.theta.parameter.r0.group.city1__all.guess.value, 51);
      assert.equal(theta.theta.parameter.r0.group.city2__all.guess.value, 51);

      done();
    });

  });




});


