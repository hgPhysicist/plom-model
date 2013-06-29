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
 * !! Data are validated only if they were previously
 * parsed (always the case for the webApp)
 *
 * !! metadata are validated at the model level as we need to know if
 *  they are used in the process or the link...
 */

Context.prototype.validate = function(){
  var that = this;

  var missing, aliens;
 
  //helper functions
  function checkString(obj, key, objName){    
    if(key in obj){ //usefull for optional keys
      if(typeof obj[key] !== 'string'){
        throw new Error(util.format('in context.json%s, "%s" has to be a string', (objName) ? ' (' + objName + ')': '', key));
      }
    } else {
      throw new Error(util.format('in context.json%s, "%s" is missing', (objName) ? ' (' + objName + ')': '', key));
    }
  }

  function checkArray(obj, key, objName){
    if(key in obj){ 
      if(!Array.isArray(obj[key])){
        throw new Error(util.format('in context.json%s, "%s" has to be a list', (objName) ? ' (' + objName + ')': '', key));
      } else if (! obj[key].length) {
        throw new Error(util.format('in context.json%s, "%s" can not be empty', (objName) ? ' (' + objName + ')': '', key));
      }
    } else {
      throw new Error(util.format('in context.json%s, "%s" is missing', (objName) ? ' (' + objName + ')': '', key));
    }
  };

  missing = _.difference(['name', 'description', 'disease', 'population', 'time_series', 'data', 'metadata'], Object.keys(this.context));
  if( missing.length ){
    throw new Error(util.format('in context.json, %s properties are missing', missing.join(',')));
  }

  checkString(this.context, 'name');
  checkString(this.context, 'description');
  checkArray(this.context, 'disease');

  this.context.population.forEach(function(p, i){
    checkString(p, 'id', 'population.' + i);
    var s = p.id.split('__');
    if(s.length !== 2){
      throw new Error('in context.json population.id has to be of the form city__age not: '+ p.id);
    }
  });

  var popId = this.context.population.map(function(x){return x.id;});

  this.context.time_series.forEach(function(t, i){
    checkString(t, 'id', 'time_series.' + i);
    checkArray(t, 'population_id', 'time_series.' + i);
    var s = t.id.split('__');
    if(s.length !== 3 && (s[2] !== 'inc' || s[2] !== 'prev')){
      throw new Error('in context.json time_series.id has to be of the form name__stream__type with type being "inc" for incidence and "prev" for prevalence,  not: '+ t.id);
    }
    
    //check that population_id elements exists
    aliens = _.difference(t.population_id, popId)
    if(aliens.length){
      throw new Error(util.format('in context.json time_series.%d.population_id, %s populations are not defined in population', i, aliens.join(',')));  
    }
  });

  var tsId = this.context.time_series.map(function(x){return x.id;});
  
  //data
  if(('source' in this.context.data) && (typeof this.context.data.source !== 'string') ){ //data have been parsed, we check
    missing = _.difference(Object.keys(this.context.data.source), tsId);
    aliens = _.difference(tsId, Object.keys(this.context.data.source));

    if(missing.length){
      throw new Error(util.format('in context.json, data are missing: [%s]', missing.join(', ')));
    }

    if(aliens.length){
      throw new Error(util.format('in context.json, data do not correspond to time_series_id: [%s]', aliens.join(', ')));
    }

    var dataLength = this.context.data.source[tsId[0]].value.length;

    for(var ts in this.context.data.source){
      parse.checkDate(this.context.data.source[ts].t0);      

      //check that t0 is before the first data point
      if(new Date(this.context.data.source[ts].t0) >= new Date(this.context.data.source[ts].value[0][0])){
        throw new Error('in context.json data.t0 has to be before first data point');
      }

      //to be relaxed one day
      if(this.context.data.source[ts].value.length !== dataLength){
        throw new Error('in context.json, data must have the same number of values');
      }
    }    

    //data must have same dates (to be relaxed)
    if(tsId.length>1){                  
      for(var l=0; l < dataLength; l++){
        var mydate = this.context.data.source[tsId[0]].value[l][0];
        for(var ts in this.context.data.source){
          if(this.context.data.source[ts].value[l][0] !== mydate){
            throw new Error('in context.json, all data streams must have the same dates');            
          }
        }
      }
    }
  }

  
}




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
