var Theta = require('..').Theta
  , fs = require('fs');

var theta = new Theta(require('./context.json'), require('./process.json'), require('./link.json'), require('./model/theta.json'));

//theta.plugBest(fs.createReadStream('./model/best_0.csv'), {index_best:10}, function(err){console.log(err);});


try{
  theta._set({set: ['r01:all:guess:0.0', 'r0:all2:guess:0.0']});
}catch(e){
  console.log(e);
}
