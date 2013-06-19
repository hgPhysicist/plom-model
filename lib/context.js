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
  options = options || {};

  this.rootContext = options.rootContext || '.';
  events.EventEmitter.call(this);
  this.context= clone(context);
}

util.inherits(Context, events.EventEmitter);


/**
 * if data comes from csv there in only on t0 property in context.data
 * we replicate it into the source object and delete the original
 * single value
 */ 
function fixt0(dataObj){

  if('t0' in dataObj){
    for(var k in dataObj.source){
      if(! ('t0' in dataObj.source[k])){
        dataObj.source[k].t0 = dataObj.t0;
      }
    }
    delete dataObj.t0;
  }

}



/**
 * context.data might contain absolute path to data.csv, this function
 * replaces the path to the .csv file to its parsed content (native array)
 */

Context.prototype.parseDataSync = function(){
  var that = this;

  var data = ('data' in this.context) ? [this.context.data] : []
    , metadata = this.context.metadata || [];

  [data, metadata].forEach(function(x, i){
    x.forEach(function(d){
      if(typeof d.source === 'string'){
        var rpath = path.resolve(that.rootContext, d.source);
        if(fs.existsSync(rpath)){
          d.source = parse.dataSync(rpath);          
          fixt0(d);
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

  var string2data = function(d, cb){
    if(typeof d.source === 'string'){
      var rpath = path.resolve(that.rootContext, d.source);
      fs.exists(rpath, function(exists){
        if(exists){
          parse.data(fs.createReadStream(rpath), function(err, pdata){
            if(err) return cb(err);
            d.source = pdata;
            fixt0(d);
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

  var metadata = that.context.metadata || [];   

  async.each(metadata, function(d, cb){string2data(d, cb);}, function(err){
    if(err || ! ('data' in that.context)){
      return callback(err);
    }
    string2data(that.context.data, callback);    
  });

};



/**
 * id is the id of metadata. If id="data" data will be loaded
 */

Context.prototype.load = function(id, callback){
  var that = this;

  var mydata;
  if(id === "data"){
    mydata = this.context['data']
  } else {
    mydata = this.context.metadata.filter(function(x){return x.id === id});
    if(!mydata.length) return callback(new Error(util.format('%s could not be found in metadata', id)));
    mydata = mydata[0];
  }
  
  if(typeof mydata.source === 'string'){
    var rpath = path.resolve(that.rootContext, mydata.source);
    fs.exists(path.normalize(rpath), function(exists){

      if(exists){
        parse.data(fs.createReadStream(rpath), function(err, parsed){
          if(err) return callback(err);
          mydata.source = parsed;         
          fixt0(mydata);         
          callback(null, parsed);
        });
      } else {
        callback(new Error(util.format('data %s (%s) could not be found.', id, rpath)));
      }

    });
  } else {
    callback(null, mydata.source);
  }

};



/**
 * Return a copy of the context data for JSON stringification. The
 * name of this method is a bit confusing, as it doesn't actually
 * return a JSON string — but I'm afraid that it's the way that the
 * JavaScript API for JSON.stringify works
*/
Context.prototype.toJSON = function() {
  return clone({context: this.context});
};

module.exports = Context;
