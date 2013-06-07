var fs = require('fs')
  , path = require('path')
  , _ = require('underscore')
  , clone = require('clone')
  , async = require('async')
  , util = require('util')
  , events = require('events')
  , parse = require('plom-parser');


/**
 * options {rootContext: } 
 * rootContext indicates the root path if data.source contain relative directories (defaults to .)
 */
function Context(context, options){
  this.rootContext = options.rootContext || '.';
  events.EventEmitter.call(this);
  this.context= clone(context);
}

util.inherits(Context, events.EventEmitter);


/**
 * context.data might contain absolute path to data.csv, this function
 * replaces the path to the .csv file to its parsed content (native array)
 */

Context.prototype.parseDataSync = function(){
  var that = this;

  var data = this.context.data || []
    , metadata = this.context.metadata || [];

  [data, metadata].forEach(function(x, i){
    x.forEach(function(d){
      if(typeof d.source === 'string'){
        var rpath = path.resolve(that.rootContext, d.source);
        if(fs.existsSync(rpath)){
          d.source = parse.dataSync(rpath, (i===0) ? 3 : 2 );
        } else {
          throw new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': data %s (%s) could not be found.', d.id, rpath));
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
      var rpath = path.resolve(that.rootContext, d.source);
      fs.exists(rpath, function(exists){
        if(exists){
          parse.data(fs.createReadStream(rpath), l, function(err, pdata){
            if(err) return cb(err);
            d.source = pdata;
            cb(null);
          });
        } else {
          cb(new Error(util.format('data %s (%s) could not be found.', d.id, rpath)));
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
  var that = this;

  var data = this.context[type] || [];
  var mydata = data.filter(function(x){return x.id === id});

  if(!mydata.length) return callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ':  %s could not be found in %s', id, type)));
  
  if(typeof mydata[0].source === 'string'){
    var rpath = path.resolve(that.rootContext, mydata[0].source);
    fs.exists(path.normalize(rpath), function(exists){

      if(exists){
        parse.data(fs.createReadStream(rpath), (type==='data') ? 3 : 2, function(err, parsed){
          if(err) return callback(err);
          mydata[0].source = parsed;
          callback(null, parsed);
        });
      } else {
        callback(new Error(util.format('\033[91m' + 'FAIL' + '\033[0m' + ': data %s (%s) could not be found.', mydata[0].id, rpath)));
      }

    });
  } else {
    callback(null, mydata[0].source);
  }

};


module.exports = Context;
