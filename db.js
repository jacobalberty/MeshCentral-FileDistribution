/** 
* @description MeshCentral-FileDistribution database module
* @author Ryan Blenis
* @copyright Ryan Blenis 2019
* @license Apache-2.0
*/

"use strict";
var Datastore = null;
var formatId = null;

module.exports.CreateDB = function(meshserver) {
    var obj = {};
    var NEMongo = require(__dirname + '/nemongo.js');
    module.paths.push(require('path').join(meshserver.parentpath, 'node_modules')); // we need to push the node_modules folder for nedb
    obj.dbVersion = 2;

    obj.initFunctions = function () {
        obj.updateDBVersion = function(new_version) {
          return obj.fdFile.updateOne({type: "db_version"}, { $set: {version: new_version} }, {upsert: true});
        };

        obj.getDBVersion = function() {
            return new Promise(function(resolve, reject) {
                obj.fdFile.find( { type: "db_version" } ).project( { _id: 0, version: 1 } ).toArray(function(err, vers){
                    if (vers.length == 0) resolve(1);
                    else resolve(vers[0]['version']);
                });
            });
        };

        obj.getFileMapsForNode = function(node) {
            return obj.fdFile.find(
                { type: 'map', node: node }
            ).sort(
                { serverpath: 1, clientpath: 1 }
            ).project(
                { serverpath: 1, clientpath: 1, filesize: 1 }
            ).toArray();
        };
        obj.getFileMapsForNodeOrMesh = function(node, mesh) {
            return obj.fdFile.find(
                { type: 'map', $or: [ { node: node }, { mesh: mesh } ] }
            ).sort(
                { serverpath: 1, clientpath: 1 }
            ).toArray()
            .then(function(rows) {
                return rows.map(function(r) {
                    return {
                        _id: r._id,
                        serverpath: r.serverpath,
                        clientpath: r.clientpath,
                        filesize: r.filesize,
                        mesh: r.mesh,
                        node: r.node,
                        scope: r.mesh ? 'group' : 'device'
                    };
                });
            });
        };
        obj.findFileForNode = function(node, cpath) {
            return obj.fdFile.find(
                { type: 'map', node: node, clientpath: cpath }
            ).toArray();
        };
        obj.findFileForMeshClientPath = function(mesh, cpath) {
            return obj.fdFile.find(
                { type: 'map', mesh: mesh, clientpath: cpath }
            ).toArray();
        };
        obj.getServerFiles = function() {
            return obj.fdFile.find(
                { type: 'map' }
            ).toArray();
        };
        obj.addFileMap = function (currentNodeId, spath, cpath, filesize) {
            return obj.fdFile.insertOne({
                type: 'map',
                node: currentNodeId,
                serverpath: spath,
                clientpath: cpath,
                filesize: filesize
            });
        };
        obj.addMeshFileMap = function (meshId, spath, cpath, filesize) {
            return obj.fdFile.insertOne({
                type: 'map',
                mesh: meshId,
                serverpath: spath,
                clientpath: cpath,
                filesize: filesize
            });
        };
        // Returns the list of distribution targets (one per online node) for a serverpath.
        // Expands mesh-keyed records into synthetic per-node entries against `meshOfNode`,
        // a { nodeId -> dbMeshKey } map of currently-online agents.
        obj.getNodesForServerPath = function(serverpath, nodeScope, meshOfNode) {
            if (nodeScope == null || !Array.isArray(nodeScope)) { nodeScope = []; }
            if (meshOfNode == null) { meshOfNode = {}; }
            return obj.fdFile.find(
                { type: 'map', serverpath: serverpath }
            ).toArray()
            .then(function(rows) {
                var out = [];
                rows.forEach(function(r) {
                    if (r.node && nodeScope.indexOf(r.node) !== -1) {
                        out.push(r);
                    } else if (r.mesh) {
                        nodeScope.forEach(function(nid) {
                            if (meshOfNode[nid] === r.mesh) {
                                out.push({
                                    _id: r._id,
                                    type: 'map',
                                    node: nid,
                                    mesh: r.mesh,
                                    serverpath: r.serverpath,
                                    clientpath: r.clientpath,
                                    filesize: r.filesize
                                });
                            }
                        });
                    }
                });
                return out;
            });
        };
        obj.update = function(id, args) {
            id = formatId(id);
            return obj.fdFile.updateOne( { _id: id }, { $set: args } );
        };
        obj.updateMany = function(where, args) {
            return obj.fdFile.updateMany( where, { $set: args } );
        };
        obj.delete = function(id) {
            id = formatId(id);
            return obj.fdFile.deleteOne( { _id: id } );
        };
        obj.get = function(id) {
            if (id == null || id == 'null') return new Promise(function(resolve, reject) { resolve([]); });
            id = formatId(id);
            return obj.fdFile.find( { _id: id } ).toArray();
        };
    };
    
    if (meshserver.args.mongodb) { // use MongDB
      require('mongodb').MongoClient.connect(meshserver.args.mongodb, { useNewUrlParser: true, useUnifiedTopology: true }, function (err, client) {
          if (err != null) { console.log("Unable to connect to database: " + err); process.exit(); return; }
          
          var dbname = 'meshcentral';
          if (meshserver.args.mongodbname) { dbname = meshserver.args.mongodbname; }
          const db = client.db(dbname);
          
          obj.fdFile = db.collection('plugin_filedistribution');
          obj.fdFile.indexes(function (err, indexes) {
              // Check if we need to reset indexes
              var indexesByName = {}, indexCount = 0;
              for (var i in indexes) { indexesByName[indexes[i].name] = indexes[i]; indexCount++; }
              if ((indexCount != 4) || (indexesByName['Node1'] == null) || (indexesByName['ServerPath1'] == null) || (indexesByName['Mesh1'] == null)) {
                  // Reset all indexes
                  console.log('Resetting plugin (FileDistribution) indexes...');
                  obj.fdFile.dropIndexes(function (err) {
                      obj.fdFile.createIndex({ serverpath: 1 }, { name: 'ServerPath1' });
                      obj.fdFile.createIndex({ node: 1 }, { name: 'Node1' });
                      obj.fdFile.createIndex({ mesh: 1 }, { name: 'Mesh1' });
                  });
              }
          });
          
          if (typeof require('mongodb').ObjectID == 'function') {
              formatId = require('mongodb').ObjectID;
          } else {
              formatId = require('mongodb').ObjectId;
          }
          obj.initFunctions();
    });  
    } else { // use NeDb
        try { Datastore = require('@seald-io/nedb'); } catch (ex) { } // This is the NeDB with Node 23 support.
        if (Datastore == null) {
            try { Datastore = require('@yetzt/nedb'); } catch (ex) { } // This is the NeDB with fixed security dependencies.
            if (Datastore == null) { Datastore = require('nedb'); } // So not to break any existing installations, if the old NeDB is present, use it.
        }
        if (obj.fdFilex == null) {
            obj.fdFilex = new Datastore({ filename: meshserver.getConfigFilePath('plugin-filedistribution.db'), autoload: true });
            obj.fdFilex.setAutocompactionInterval(40000);
            obj.fdFilex.ensureIndex({ fieldName: 'serverpath' });
            obj.fdFilex.ensureIndex({ fieldName: 'node' });
            obj.fdFilex.ensureIndex({ fieldName: 'mesh' });
        }
        obj.fdFile = new NEMongo(obj.fdFilex);
        formatId = function(id) { return id; };
        obj.initFunctions();
    }
    
    return obj;
}