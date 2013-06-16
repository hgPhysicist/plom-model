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
    context = new Context(require(path.join(root, 'context.json')), {rootContext:root}); 
  });

  it('should parse data synchronously', function(){
    context.parseDataSync();
    assert.deepEqual(context.context, require(path.join(root, 'expected', 'context.json')));
  });

  it('should parse data asynchronosly', function(done){
    context.parseData(function(err){
      assert.deepEqual(context.context, require(path.join(root, 'expected', 'context.json')));
      done();
    });
  });
  
  it('should load data', function(done){
    context.load('data', function(err, data){
      assert.deepEqual(data, require(path.join(root, 'expected', 'context.json')).data.source);
      done();
    });
  });

  it('should load metadata', function(done){
    context.load('mu_b', function(err, data){
      assert.deepEqual(data, require(path.join(root, 'expected', 'context.json')).metadata.filter(function(x){return x.id==='mu_b'})[0].source);
      done();
    });
  });

});


describe('model with remainder', function(){

  var model
    , pop_size;

  before(function(done){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')), {rootContext:root});
    model.load('metadata', 'N', function(err, my_pop_size){
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

});



describe('model without remainder', function(){

  var model
    , pop_size;

  before(function(done){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process_no_remainder.json')), require(path.join(root, 'link.json')), {rootContext:root});
    model.load('metadata', 'N', function(err, my_pop_size){
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


describe('validate',function(){
  var model;

  beforeEach(function(){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')), {rootContext:root});
  }),
  
  it('should validate standard model', function(){
    assert.doesNotThrow(function(){      
        model.validate();     
    }, Error);
  });

  it('should accept numerical values in rates and observation', function(){
    assert.doesNotThrow(function(){
      model.process.model[0].rate = '2*'+model.process.model[0].rate;
      model.validate();
      model.process.model[0].rate = '2.0*'+model.process.model[0].rate;
      model.validate();
      model.link.observation[0].model.mean = '2*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.mean = '2.0*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.var = '2*'+model.link.observation[0].model.var;
      model.validate();
      model.link.observation[0].model.var = '2.0*'+model.link.observation[0].model.var;
      model.validate();
    });
  });

  it('should throw error if unknown value is given', function(){
    assert.throws(function(){
      model.process.model[0].rate = 'z*'+model.process.model[0].rate; 
      model.validate();    
    });

    assert.throws(function(){
      model.link.observation[0].model.mean = 'z*' + model.link.observation[0].model.mean;     
      model.validate();
    });

    assert.throws(function(){    
      model.link.observation[0].model.var = 'z*' + model.link.observation[0].model.var;
      model.validate();
    });
  });

  it('should accept special expressions and functions in rates and observation', function(){
    assert.doesNotThrow(function(){
      model.process.model[0].rate = 'M_PI*'+model.process.model[0].rate;
      model.validate();
      model.process.model[0].rate = 'GSL_CONST_MKSA_SPEED_OF_LIGHT*'+model.process.model[0].rate;
      model.validate();
      model.process.model[0].rate = 't*'+model.process.model[0].rate;
      model.validate();
      model.process.model[0].rate = 'ONE_YEAR*'+model.process.model[0].rate;
      model.validate();
      model.process.model[0].rate = 'cos(t)*'+model.process.model[0].rate;
      model.validate();
      model.link.observation[0].model.mean = 'M_PI*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.mean = 'GSL_CONST_MKSA_SPEED_OF_LIGHT*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.mean = 't*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.mean = 'ONE_YEAR*'+model.link.observation[0].model.mean;
      model.validate();
      model.link.observation[0].model.mean = 'cos(t)*'+model.link.observation[0].model.mean;
      model.validate(); 
      model.link.observation[0].model['var'] = 'M_PI*'+model.link.observation[0].model['var'];
      model.validate();
      model.link.observation[0].model['var'] = 'GSL_CONST_MKSA_SPEED_OF_LIGHT*'+model.link.observation[0].model['var'];
      model.validate();
      model.link.observation[0].model['var'] = 't*'+model.link.observation[0].model['var'];
      model.validate();
      model.link.observation[0].model['var'] = 'ONE_YEAR*'+model.link.observation[0].model['var'];
      model.validate();
      model.link.observation[0].model['var'] = 'cos(t)*'+model.link.observation[0].model['var'];
      model.validate();
    });
  });

  it('should throw error when white noise put on non-existing reaction', function(){
    assert.throws(function(){
      model.process.white_noise[0].reaction[0].to = 'W';
      model.validate();
    });

    assert.throws(function(){
      model.process.white_noise[0].reaction[0].to = 'S';
      model.process.white_noise[0].reaction[0].from = 'I';
      model.validate();
    });    
  });

  it('should throw error when white noise is specified through "to" and "from" without "rate" when several such reactions exist', function(){
    assert.throws(function(){
      model.link.observed[2].definition[0].to = 'I';
      model.link.observed[2].definition[0].from = 'R';
      model.process.model[0].from = 'S';
      model.process.model[0].to = 'I';
      model.validate();
    });
  });


  it('should throw error when incidence of non-existing reaction is observed', function(){
    assert.throws(function(){
      model.link.observed[2].definition[0].to = 'W';
      model.validate();
    });

    assert.throws(function(){
      model.link.observed[2].definition[0].to = 'S';
      model.link.observed[2].definition[0].from = 'I';
      model.validate();
    });
  });

  it('should throw error when observed incidence is specified through "to" and "from" without "rate" when several such reactions exist', function(){
    assert.throws(function(){
      model.process.white_noise = [];
      model.process.model[0].from = 'S';
      model.process.model[0].to = 'I';
      model.validate();
    });
  });
  
  it('should accept when rate is specified to exclude ambiguity', function(){
    assert.doesNotThrow(function(){
      model.process.model[0].from = 'S';
      model.process.model[0].to = 'I';
      model.process.white_noise[0].reaction[0].rate = 'r0/N*v*I';
      model.link.observed[2].definition[0].rate =  'r0/N*v*I';
      model.validate();
    });
  });
  
});

describe('validate model with diffusion', function(){
  var model;

  beforeEach(function(){
    model = new Model(require(path.join(root, 'context.json')), require(path.join(root, 'process_diffusion.json')), require(path.join(root, 'link.json')), {rootContext:root});
  }),

  it('should validate standard model', function(){
    assert.doesNotThrow(function(){
      model.validate();
    });
  });

  it('should reject diffusions that are set on unknown parameters',function(){
    assert.throws(function(){
      model.process.diffusion[0].parameter = 'alpha';
      model.validate();
    });
  });

  it('should reject models with non-zero drift',function(){
    assert.throws(function(){
      model.process.diffusion[0].drift = '5';
      model.validate();
    });
  });

  it('should accept 0 or 0.0 drifts',function(){
    assert.doesNotThrow(function(){    
      model.process.diffusion[0].drift = '0';
      model.validate();
      model.process.diffusion[0].drift = '0.0';
      model.validate();
    });
  });

  it('should reject volatilities other than a single parameter',function(){
    assert.throws(function(){
      model.process.diffusion[0].volatility = 'alpha';
      model.validate();
    });

    assert.throws(function(){
      model.process.diffusion[0].drift = '3*vol';
      model.validate();
    });

    assert.throws(function(){
      model.process.diffusion[0].drift = '3';
      model.validate();
    });

  });  
});




describe('theta', function(){

  var theta;

  beforeEach(function(){
    theta = new Theta(require(path.join(root, 'context.json')), require(path.join(root, 'process.json')), require(path.join(root, 'link.json')), require(path.join(root, 'theta.json')), {rootContext:root}); 
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

  it('should plug hat', function(done){
    var n = 3;
    theta.adapt();
    theta.plugHat({root:path.join(root, 'results'), state: 'hat_0.csv', index_state: n}, function(err){
      if(err) throw err;
      parse.obj_n(fs.createReadStream(path.join(root, 'results', 'hat_0.csv')), {key: 'time', n: n}, function(err, hat){
        theta.load('metadata', 'N', function(err, N){          
          assert.equal(theta.theta.parameter.S.group.city1__all.guess.value, hat['S:city1__all']/N[n+1][1]);
          assert.equal(theta.theta.parameter.S.group.city2__all.guess.value, hat['S:city2__all']/N[n+1][2]);          
          assert.equal(theta.theta.parameter.I.group.all.guess.value, (hat['I:city1__all']/N[n+1][1] + hat['I:city2__all']/N[n+1][2])/2);         
          done();
        });
      });
    });
  });

  it('should plug hat with n === -1', function(done){
    var n = -1;
    theta.adapt();
    theta.plugHat({root:path.join(root, 'results'), state: 'hat_0.csv', index_state: n}, function(err){
      if(err) throw err;
      parse.obj_n(fs.createReadStream(path.join(root, 'results', 'hat_0.csv')), {key: 'time', n: n}, function(err, hat){
        theta.load('metadata', 'N', function(err, N){          
          assert.equal(theta.theta.parameter.S.group.city1__all.guess.value, hat['S:city1__all']/N[N.length-1][1]);
          assert.equal(theta.theta.parameter.S.group.city2__all.guess.value, hat['S:city2__all']/N[N.length-1][2]);          
          assert.equal(theta.theta.parameter.I.group.all.guess.value, (hat['I:city1__all']/N[N.length-1][1] + hat['I:city2__all']/N[N.length-1][2])/2);         
          done();
        });
      });
    });
  });


  it('should plug hat and ungroup', function(done){
    var n = 3;
    theta.adapt();
    theta.plugHat({root:path.join(root, 'results'), state: 'hat_0.csv', index_state: n, ungroup: true}, function(err){
      if(err) throw err;
      parse.obj_n(fs.createReadStream(path.join(root, 'results', 'hat_0.csv')), {key: 'time', n: n}, function(err, hat){
        theta.load('metadata', 'N', function(err, N){          
          assert.equal(theta.theta.parameter.S.group.city1__all.guess.value, hat['S:city1__all']/N[n+1][1]);
          assert.equal(theta.theta.parameter.S.group.city2__all.guess.value, hat['S:city2__all']/N[n+1][2]);          
          
          assert.equal(theta.theta.parameter.I.group.city1__all.guess.value, hat['I:city1__all']/N[n+1][1]);
          assert.equal(theta.theta.parameter.I.group.city2__all.guess.value, hat['I:city2__all']/N[n+1][2]);
          done();
        });
      });
    });
  });


  it('should rescale', function(done){
    theta.adapt();
        
    var rep = theta.theta.parameter.rep.group.all.guess.value;
    
    theta.rescale({root:path.join(root, 'results'), rescale:['rep', 'hat_0.csv']}, function(err){
      if(err) throw err;

      var hatMean = {
        all__CDC__inc: 1091.3180,
        all__google__inc:  1091.3180,
        city2__CDC__inc: 546.4047,
        city1__CDC__prev: 857.4636
      };

      var dataMean = {
        all__CDC__inc: 1491.3415,
        all__google__inc: 1240.3111,
        city2__CDC__inc: 701.7872,
        city1__CDC__prev: 904.0426
      };
            
      var goodRep = 0.0;
      for (var ts in hatMean){
        goodRep += dataMean[ts] / (hatMean[ts]/rep);
      }

      assert.equal(theta.theta.parameter.rep.group.all.guess.value.toPrecision(4), (goodRep/4).toPrecision(4));

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

