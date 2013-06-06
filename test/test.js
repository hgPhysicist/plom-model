var Context = require('..').Context
  , Model = require('..').Model
  , path = require('path')
  , Theta = require('..').Theta
  , parse = require('plom-parser')
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


describe('model with remainder', function(){

  var model
    , pop_size;

  before(function(done){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')));
    model.load('metadata', 'N', root, function(err, my_pop_size){
      pop_size = my_pop_size;
      done();
    });
  });


  it('should extract par_sv', function(){
    assert.deepEqual(model.par_sv, ['S', 'I']);
  });

  it('should extract par_proc', function(){
    assert.deepEqual(model.par_proc, ['r0', 'v', 'sto']);
  });

  it('should extract par_obs', function(){
    assert.deepEqual(model.par_obs, ['rep', 'phi']);
  });

  it('should extract pop_size_eq_sum_sv', function(){
    assert(!model.pop_size_eq_sum_sv);
  })

  it('should get the population size', function(){   
    assert.deepEqual(model._getPopSize_n(pop_size, [], 3), { date: '2012-08-23', city1__all: 1000001, city2__all: 1000002 });
  });

  it('should get the population size with n too large', function(){
    assert.deepEqual(model._getPopSize_n(pop_size, [], 3000), { date: '2013-07-25', city1__all: 1000010, city2__all: 1000020 });
  });

});



describe('model without remainder', function(){

  var model
    , pop_size;

  before(function(done){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process_no_remainder.json')), require(path.join(root, 'link.json')));
    model.load('metadata', 'N', root, function(err, my_pop_size){
      pop_size = my_pop_size;
      done();
    });
  });

  it('should extract par_sv', function(){
    assert.deepEqual(model.par_sv, ['S', 'I', 'R']);
  });

  it('should extract pop_size_eq_sum_sv', function(){
    assert(model.pop_size_eq_sum_sv);
  })

  it('should get the population size', function(done){
    parse.obj_n(fs.createReadStream(path.join(root, 'results', 'hat_no_remainder_0.csv')), {key:'time', n:3}, function(err, hat_n){
      if(err) throw err;      
      assert.equal(hat_n.time, 3);
      var city1__all = hat_n['S:city1__all'] + hat_n['I:city1__all'] + hat_n['R:city1__all'];
      var city2__all = hat_n['S:city2__all'] + hat_n['I:city2__all'] + hat_n['R:city2__all'];
            
      assert.deepEqual(model._getPopSize_n(pop_size, hat_n, 3), {city1__all: city1__all, city2__all: city2__all});
      done();
    });      
  });

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


  it('should load the covariance', function(done){
    theta.plugCov({covariance: true, root:path.join(root, 'results')}, function(err){
      if(err) throw err;
      assert.equal(theta.theta.covariance.length, 10);
      assert.equal(theta.theta.covariance[0].length, 10);
      done();
    });
  });

  it('should set theta', function(done){
    theta.adapt();
    theta.mutate({
      set: [
        'r0:city1__all:min:6',
        'r0:city2__all:min:7',
        'r0:city1__all:guess:16',
        'r0:city2__all:guess:17',
        'r0:city1__all:max:46',
        'r0:city2__all:max:47',
        'r0:city1__all:sd_transf:0.06',
        'r0:city2__all:sd_transf:0.07',
        'v:transformation:identity',
        'v:all:prior:normal',
      ]
    }, function(err){
      if(err) throw(err);

      assert.equal(theta.theta.parameter.r0.group.city1__all.min.value, 6);
      assert.equal(theta.theta.parameter.r0.group.city2__all.min.value, 7);

      assert.equal(theta.theta.parameter.r0.group.city1__all.guess.value, 16);
      assert.equal(theta.theta.parameter.r0.group.city2__all.guess.value, 17);

      assert.equal(theta.theta.parameter.r0.group.city1__all.max.value, 46);
      assert.equal(theta.theta.parameter.r0.group.city2__all.max.value, 47);

      assert.equal(theta.theta.parameter.r0.group.city1__all.sd_transf.value, 0.06);
      assert.equal(theta.theta.parameter.r0.group.city2__all.sd_transf.value, 0.07);

      assert.equal(theta.theta.parameter.v.transformation, 'identity');
      assert.equal(theta.theta.parameter.v.group.all.prior.value, 'normal');

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





  it.skip('should predict', function(done){

    theta.adapt();
    theta.predict(3, fs.createReadStream(path.join(root, 'results', 'X_0.csv')), fs.createReadStream(path.join(root, 'results', 'best_0.csv')), {}, function(err, thetas){         
      done();
    });

  });

});


