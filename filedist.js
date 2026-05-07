/** 
* @description MeshCentral File Distribution Plugin
* @author Ryan Blenis
* @copyright 
* @license Apache-2.0
*/

"use strict";

module.exports.filedist = function (parent) {
    var obj = {};
    obj.parent = parent; // keep a reference to the parent
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.db = null;
    obj.VIEWS = __dirname + '/views/';
    obj.path = require('path');
    obj.intervalTimer = null;
    obj.exports = [
      'onDeviceRefreshEnd',
      'mapData',
      'addError'
    ];
    var PLUGIN_L = 'filedist';
    var PLUGIN_C = 'FileDist';
    
    obj.sendAllMaps = function(comp, maps) {
        const command = {
            action: 'plugin',
            plugin: 'filedist',
            pluginaction: 'setMaps',
            maps: maps
        };
        try { 
            obj.debug('PLUGIN', PLUGIN_C, 'Sending file maps to ' + comp);
            obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
        } catch (e) { 
            obj.debug('PLUGIN', PLUGIN_C, 'Could not send file maps to ' + comp); 
        }
    };
    
    obj.sendMap = function(comp, map) {
        const command = {
            action: 'plugin',
            plugin: 'filedist',
            pluginaction: 'addMap',
            map: map
        };
        try { 
            obj.debug('PLUGIN', PLUGIN_C, 'Sending file map to ' + comp);
            obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
        } catch (e) { 
            obj.debug('PLUGIN', PLUGIN_C, 'Could not send file map to ' + comp); 
        }
    };
    
    // Build a { nodeId -> dbMeshKey } map for every currently-online agent.
    obj.getOnlineMeshOfNode = function() {
        var meshOfNode = {};
        var wsagents = obj.meshServer.webserver.wsagents;
        for (var nid in wsagents) {
            if (wsagents[nid] && wsagents[nid].dbMeshKey) {
                meshOfNode[nid] = wsagents[nid].dbMeshKey;
            }
        }
        return meshOfNode;
    };

    obj.hook_agentCoreIsStable = function(myparent, gp) { // check for remaps when an agent logs in
        obj.db.getFileMapsForNodeOrMesh(myparent.dbNodeKey, myparent.dbMeshKey)
        .then((maps) => {
            if (maps.length) {
                obj.sendAllMaps(myparent.dbNodeKey, maps);
            }
        })
    };

    obj.checkFileSizes = function() {
        // check files to see if they've changed for linked maps
        var onlineAgents = Object.keys(obj.meshServer.webserver.wsagents);
        var meshOfNode = obj.getOnlineMeshOfNode();
        var checked = [];
        obj.db.getServerFiles()
        .then((maps) => {
            if (maps.length) {
                maps.forEach(function(m) {
                    if (checked.indexOf(m.serverpath) == -1) {
                        var realPath = obj.getServerFilePath(m.serverpath);
                        var sz = 0;
                        try {
                            var fs = require('fs');
                            sz = fs.statSync(realPath.fullpath).size;
                        } catch (e) {
                            sz = null;
                        }
                        if (m.filesize != sz) {
                            if (sz === null) {
                                obj.debug('PLUGIN', PLUGIN_C, 'Source file missing, skipping broadcast for ' + m.serverpath);
                            } else {
                                obj.db.updateMany({ type: 'map', serverpath: m.serverpath }, { filesize: sz })
                                .then(() => {
                                    // only online nodes; offline ones get new maps when they come online
                                    obj.db.getNodesForServerPath(m.serverpath, onlineAgents, meshOfNode)
                                    .then((targets) => {
                                        if (targets.length) {
                                            targets.forEach(function(ma) {
                                                obj.sendMap(ma.node, ma);
                                            });
                                        }
                                    });
                                })
                            }
                        }
                        checked.push(m.serverpath);
                    }
                })
            }
        })
    };
    
    obj.resetQueueTimer = function() {
        clearTimeout(obj.intervalTimer);
        obj.intervalTimer = setInterval(obj.checkFileSizes, 1 * 60 * 1000 * 20); // every 20 minutes
    };
    
    obj.server_startup = function() {
        obj.meshServer.pluginHandler.filedist_db = require (__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.filedist_db;
        obj.resetQueueTimer();
    };

    obj.onDeviceRefreshEnd = function() {
        pluginHandler.registerPluginTab({
            tabTitle: 'File Distribution ',
            tabId: 'pluginFileDist'
        });
        QA('pluginFileDist', '<iframe id="pluginIframeFileDist" style="width: 100%; height: 800px;" scrolling="no" frameBorder=0 src="/pluginadmin.ashx?pin=filedist&user=1&node='+ currentNode._id +'" />');
    };
    
    obj.mapData = function (message) {
        if (typeof pluginHandler.filedist.loadMaps == 'function') pluginHandler.filedist.loadMaps(message);
    };

    obj.addError = function (message) {
        if (typeof pluginHandler.filedist.showAddError == 'function') pluginHandler.filedist.showAddError(message.event.message);
    };

    obj.handleAdminReq = function(req, res, user) {
        if ((user.siteadmin & 0xFFFFFFFF) == 1 && req.query.admin == 1)
        {
            // admin wants admin, grant
            var vars = {};
            res.render(obj.VIEWS + 'admin', vars);
            return;
        } else if (req.query.admin == 1 && (user.siteadmin & 0xFFFFFFFF) == 0) {
            // regular user wants admin
            res.sendStatus(401);
            return;
        } else if (req.query.user == 1) {
            // regular user wants regular access, grant
            // Resolve the node's meshid from the main DB; do not trust query string.
            obj.meshServer.db.Get(req.query.node, function(err, docs) {
                if (err || !docs || !docs.length) { res.sendStatus(404); return; }
                var node = docs[0];
                var meshid = node.meshid;
                var vars = { filemaps: 'null', currentMeshId: JSON.stringify(meshid) };
                obj.db.getFileMapsForNodeOrMesh(req.query.node, meshid)
                .then(maps => {
                    vars.filemaps = JSON.stringify(maps);
                    res.render(obj.VIEWS + 'user', vars);
                });
            });
            return;
        } else if (req.query.include == 1) {
            switch (req.query.path.split('/').pop().split('.').pop()) {
                case 'css':     res.contentType('text/css'); break;
                case 'js':      res.contentType('text/javascript'); break;
            }
            res.sendFile(__dirname + '/includes/' + req.query.path); // don't freak out. Express covers any path issues.
            return;
        }
        res.sendStatus(401); 
        return;
    };
    
    obj.getServerFilePath = function (path) {
        var splitpath = path.split('/'), serverpath = obj.meshServer.path.join(obj.meshServer.filespath, 'domain'), filename = '';
        var objid = splitpath[0] + '/' + splitpath[1] + '/' + splitpath[2];
        if (splitpath[1] != '') { serverpath += '-' + splitpath[1]; } // Add the domain if needed
        serverpath += ('/' + splitpath[0] + '-' + splitpath[2]);
        for (var i = 3; i < splitpath.length; i++) { if (obj.meshServer.common.IsFilenameValid(splitpath[i]) == true) { serverpath += '/' + splitpath[i]; filename = splitpath[i]; } else { return null; } } // Check that each folder is correct
        return { fullpath: obj.meshServer.path.resolve(obj.meshServer.filespath, serverpath), path: serverpath, name: filename };
    };
    
    obj.sendFile = function(comp, serverpath, clientpath, size) {
        const command = {
            action: 'plugin',
            plugin: PLUGIN_L,
            pluginaction: 'sendFile',
            clientpath: clientpath
        };
        var realPath = obj.getServerFilePath(serverpath);
        if (realPath == null) {
            obj.debug('PLUGIN', PLUGIN_C, 'Refusing to send: invalid server path: ' + serverpath);
            return;
        }
        try {
            obj.debug('PLUGIN', PLUGIN_C, 'Sending file to ' + comp);
            var fs = require('fs');
            var path = realPath.fullpath;
            try {
                fs.statSync(path);
                var readStream = fs.createReadStream(path, { encoding: "hex" });
                readStream.on('data', function (chunk) {
                    command.data = chunk;
                    obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
                })
                readStream.on('end', function (chunk) {
                    command.data = 'END';
                    obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
                })
            } catch (e) {
                obj.debug('PLUGIN', PLUGIN_C, 'Refusing to send: source file missing: ' + serverpath + ' (target ' + comp + ')');
            }
        } catch (e) { 
            obj.debug('PLUGIN', PLUGIN_C, 'Could not send file to ' + comp + e.stack); 
        }
    };
    
    // Push a per-node map list to a single user's tab. Used for both single-device
    // updates and broadcast-to-mesh updates (caller invokes once per affected node).
    obj.dispatchMapsToFrontEnd = function(nodeId, meshIdHint) {
        var targetMesh = meshIdHint || null;
        return obj.meshServer.db.Get(nodeId, function(err, docs) {
            var meshid = (docs && docs[0] && docs[0].meshid) || targetMesh;
            obj.db.getFileMapsForNodeOrMesh(nodeId, meshid)
            .then((nodeMaps) => {
                var targets = ['*', 'server-users'];
                obj.meshServer.DispatchEvent(targets, obj, { nolog: true, action: 'plugin', plugin: PLUGIN_L, pluginaction: 'mapData', nodeId: nodeId, mapData: nodeMaps });
            });
        });
    };

    obj.updateFrontEnd = async function(ids){
        if (ids.maps == null) return;
        if (ids.meshId) {
            // Refresh every online member of this mesh.
            var wsagents = obj.meshServer.webserver.wsagents;
            for (var nid in wsagents) {
                if (wsagents[nid] && wsagents[nid].dbMeshKey === ids.meshId) {
                    obj.dispatchMapsToFrontEnd(nid, ids.meshId);
                }
            }
            return;
        }
        if (ids.nodeId) {
            obj.dispatchMapsToFrontEnd(ids.nodeId);
        }
    };

    obj.notifyUserError = function(myparent, currentNodeId, message) {
        try {
            obj.debug('PLUGIN', PLUGIN_C, message);
            var userId = (myparent && myparent.user && myparent.user._id) ? myparent.user._id : null;
            if (userId) {
                obj.meshServer.DispatchEvent([userId], obj, {
                    nolog: true,
                    action: 'plugin',
                    plugin: PLUGIN_L,
                    pluginaction: 'addError',
                    nodeId: currentNodeId,
                    message: message
                });
            }
        } catch (e) {
            console.log('PLUGIN: FileDistribution: notifyUserError failed', e && e.stack);
        }
    };

    obj.userMeshRights = function(user, meshId) {
        try {
            if (!user || !meshId) return 0;
            if (typeof obj.meshServer.webserver.GetMeshRights === 'function') {
                return obj.meshServer.webserver.GetMeshRights(user, meshId);
            }
        } catch (e) { /* fall through */ }
        return 0;
    };

    obj.serveraction = function(command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'addFileMap': {
                // Validate server-side source file exists for both device and mesh scopes.
                var realPath = obj.getServerFilePath(command.spath);
                if (realPath == null) {
                    obj.notifyUserError(myparent, command.currentNodeId, 'Source file path is invalid: ' + command.spath);
                    break;
                }
                var sz = null;
                try {
                    var fs = require('fs');
                    sz = fs.statSync(realPath.fullpath).size;
                } catch (e) {
                    obj.notifyUserError(myparent, command.currentNodeId, 'Source file not found on server: ' + command.spath);
                    break;
                }

                if (command.targetType === 'mesh') {
                    var meshId = command.meshId;
                    if (!meshId) {
                        obj.notifyUserError(myparent, command.currentNodeId, 'No device group specified for group-wide map.');
                        break;
                    }
                    var rights = obj.userMeshRights(myparent && myparent.user, meshId);
                    if ((rights & 0xFFFFFFFF) === 0) {
                        obj.notifyUserError(myparent, command.currentNodeId, 'You do not have rights to add a group-wide file map for this device group.');
                        break;
                    }
                    obj.db.addMeshFileMap(meshId, command.spath, command.cpath, sz)
                    .then(() => obj.updateFrontEnd({ maps: true, meshId: meshId }))
                    .then(() => {
                        var wsagents = obj.meshServer.webserver.wsagents;
                        for (var nid in wsagents) {
                            if (wsagents[nid] && wsagents[nid].dbMeshKey === meshId) {
                                obj.sendMap(nid, { clientpath: command.cpath, filesize: sz });
                            }
                        }
                    })
                    .catch(e => console.log('PLUGIN: FileDistribution: Unable to send mesh map', e && e.stack));
                } else {
                    obj.db.addFileMap(command.currentNodeId, command.spath, command.cpath, sz)
                    .then(() => obj.updateFrontEnd({ maps: true, nodeId: command.currentNodeId }))
                    .then(() => {
                        obj.sendMap(command.currentNodeId, { clientpath: command.cpath, filesize: sz });
                    })
                    .catch(e => console.log('PLUGIN: FileDistribution: Unable to send map', e && e.stack));
                }
                break;
            }
            case 'deleteMap': {
                obj.db.get(command.id)
                .then(records => {
                    var record = records && records[0];
                    if (!record) { return; }
                    if (record.mesh) {
                        var rights = obj.userMeshRights(myparent && myparent.user, record.mesh);
                        if ((rights & 0xFFFFFFFF) === 0) {
                            obj.notifyUserError(myparent, command.currentNodeId, 'You do not have rights to delete a group-wide file map for this device group.');
                            return;
                        }
                        return obj.db.delete(command.id).then(() => {
                            obj.updateFrontEnd({ maps: true, meshId: record.mesh });
                        });
                    }
                    return obj.db.delete(command.id).then(() => {
                        obj.updateFrontEnd({ maps: true, nodeId: command.currentNodeId });
                    });
                })
                .catch(e => console.log('PLUGIN: FileDistribution: Unable to delete map', e && e.stack));
                break;
            }
            case 'fetchFile':
                obj.db.findFileForNode(myparent.dbNodeKey, command.clientpath)
                .then(maps => {
                    if (maps && maps.length) {
                        var map = maps[0];
                        obj.sendFile(map.node, map.serverpath, map.clientpath, map.filesize);
                        return;
                    }
                    // Fallback: mesh-scoped map for the agent's mesh
                    return obj.db.findFileForMeshClientPath(myparent.dbMeshKey, command.clientpath)
                    .then(meshMaps => {
                        if (!meshMaps || !meshMaps.length) {
                            obj.debug('PLUGIN', PLUGIN_C, 'fetchFile: no map found for ' + myparent.dbNodeKey + ' / ' + command.clientpath);
                            return;
                        }
                        var map = meshMaps[0];
                        obj.sendFile(myparent.dbNodeKey, map.serverpath, map.clientpath, map.filesize);
                    });
                })
                .catch(e => console.log('PLUGIN: FileDistribution: Could not complete fetchFile', e && e.stack))
            break;
            default:
                console.log('PLUGIN: FileDistribution: unknown action');
            break;
        }
    };
    
    return obj;
}