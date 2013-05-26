var fs = require('fs')
  , path = require('path')
  , _ = require('underscore')
  , clone = require('clone')
  , async = require('async')
  , util = require('util')
  , parse = require('plom-parser');

function Context(context){
  this.context= clone(context);
}

/**
 * context.data might contain absolute path to data.csv, this function
 * replaces the path to the .csv file to its parsed content (native array)
 */

Context.prototype.parseDataSync = function(){

  var data = this.context.data || []
    , metadata = this.context.metadata || [];

  [data, metadata].forEach(function(x, i){
    x.forEach(function(d){
      if(typeof d.source === 'string'){
        if(fs.existsSync(path.normalize(d.source))){
          d.source = parse.dataSync(d.source, (i===0) ? 3 : 2 );
        } else {
          throw new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': data %s (%s) could not be found.', d.id, d.source));
        }
      }
    });
  });

};




/**
 * context.data might contain absolute path to data.csv, this function
 * replaces the path to the .csv file to its parsed content (native array)
 */

Context.prototype.parseData = function(callback){
  var that = this;

  var string2data = function(d, l, cb){
    if(typeof d.source === 'string'){
      fs.exists(path.normalize(d.source), function(exists){
        if(exists){
          parse.data(fs.createReadStream(path.normalize(d.source)), l, function(err, pdata){
            if(err) return cb(err);
            d.source = pdata;
            cb(null);
          });
        } else {
          cb(new Error(util.format('data %s (%s) could not be found.', d.id, d.source)));
        }
      });
    } else {
      cb(null);
    }
  };

  var data = this.context.data || [];
  async.each(data, function(d, cb){string2data(d, 3, cb);}, function(err){
    if(err) return callback(err);
    var metadata = that.context.metadata || [];
    if(!metadata.length) return callback(null);

    async.each(metadata, function(d, cb){string2data(d, 2, cb);}, callback);
  });

};






/**
 * type is data or metadata
 * id is the data or metadata name
 */
Context.prototype.load = function(type, id, callback){

  var data = this.context[type] || [];

  var mydata = data.filter(function(x){return x.id === id});

  if(!mydata.length) return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ':  %s could not be found in %s', id, type)));
  
  if(typeof mydata[0].source === 'string'){
    fs.exists(path.normalize(mydata[0].source), function(exists){

      if(exists){
        parse.data(fs.createReadStream(mydata[0].source), (type==='data') ? 3 : 2, function(err, parsed){
          if(err) return callback(err);
          mydata[0].source = parsed;
          callback(null, parsed);
        });
      } else {
        callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': data %s (%s) could not be found.', mydata[0].id, mydata[0].source)));
      }

    });
  } else {
    callback(null, mydata[0].source);
  }

};


module.exports = Context;
