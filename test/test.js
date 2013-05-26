var Context = require('..').Context
  , Theta = require('..').Theta
  , clone = require('clone')
  , fs = require('fs')
  , assert = require('assert');


describe('context', function(){

  var context;

  beforeEach(function(){
    context = new Context(require('./context.json')); 
  });

  it('should parse data synchronously', function(){
    context.parseDataSync();
    assert.deepEqual(context.context, require('./expected/context.json'));
  });

  it('should parse data asynchronosly', function(done){
    context.parseData(function(err){
      assert.deepEqual(context.context, require('./expected/context.json'));
      done();
    });
  });

});



describe('theta', function(){

  var theta;

  beforeEach(function(){
    theta = new Theta(require('./context.json'), require('./process.json'), require('./link.json'), require('./theta.json')); 
  });


  it('should adapt theta', function(){
    theta.adapt();
    assert.deepEqual(theta.theta, require('./expected/theta.json'));
  });

});


