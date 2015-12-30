var express = require("express");
var path = require("path");
var xmldom = require('xmldom');
var fs = require('fs');
var parser = require('xmldom').DOMParser;
var FolderNode = require('./foldernode.js').FolderNode;
var DeviceNode = require('./devicenode.js').DeviceNode;

var basicAuth = require('basic-auth');

var ISYServer = function(port) {
    this.app = express();
    this.port = port;
    this.nodeIndex = {};
    this.config = {};
    this.setConfigSetting(this.CONFIG_ELK_ENABLED, false);
    this.setConfigSetting(this.CONFIG_EXTENDED_ERRORS, true);
    this.setConfigSetting(this.CONFIG_USERNAME, 'admin');
    this.setConfigSetting(this.CONFIG_PASSWORD, 'password');
    this.setConfigSetting(this.CONFIG_REQUIRE_AUTH, true);
}

ISYServer.prototype.CONFIG_ELK_ENABLED = 'elkEnabled';
ISYServer.prototype.CONFIG_EXTENDED_ERRORS = 'extendedErrors';
ISYServer.prototype.CONFIG_USERNAME = 'userName';
ISYServer.prototype.CONFIG_PASSWORD = 'password';
ISYServer.prototype.CONFIG_REQUIRE_AUTH = 'requireAuth';

ISYServer.prototype.getConfigSetting = function(settingName) {
    return this.config[settingName];
}

ISYServer.prototype.setConfigSetting = function(settingName, value) {
    this.config[settingName] = value;    
}

ISYServer.prototype.buildCommandResponse = function(res, resultSuccess, resultCode, extended) {
    this.setupResponseHeaders(res, resultCode);
    var resultString = 
        '<?xml version="1.0" encoding="UTF-8"?>\r\n'+
        '<RestResponse succeeded="'+resultSuccess+   '">\r\n'+
        '    <status>'+resultCode+'</status>\r\n';
    if(this.getConfigSetting(this.CONFIG_EXTENDED_ERRORS) && extended != undefined && extended != null) {
        resultString += '    <extended>'+extended+'</extended>\r\n';
    }
    resultString += '</RestResponse>\r\n'; 
    res.send(resultString);
} 

ISYServer.prototype.setupResponseHeaders = function(res, resultCode) {
    res.set('EXT','UCoS, UPnP/1.0, UDI/1.0');
    res.set('Cache-Control', 'no-cache');
    res.set('WWW-Authenticate','Basic realm="/"');
    res.set('Last-Modified', new Date());
    res.set('Connection','Keep-Alive');
    res.set('Content-Type', 'text/xml; charset=UTF-8');    
    res.status(resultCode);
}

ISYServer.prototype.hadleNodesRequest = function(req,res) {
    this.setupResponseHeaders(res,200);
    res.send(this.rootDoc.toString());
}

ISYServer.prototype.handleCommandRequest = function(req, res) {
    var nodeToUpdate = this.nodeIndex[req.params.address];
    if(nodeToUpdate == undefined || nodeToUpdate == null) {
        this.buildResponse(res, false, 404);
    } else {
        try {
            nodeToUpdate.simulateExecuteCommand(req.params.command, req.params.parameter);
            this.buildResponse(res, true, 200);
        }
        catch(err) {
            this.buildResponse(res, false, 500, err);
        }
    }    
}

ISYServer.prototype.handleConfigureRequest = function(req, res) {
    var configName = req.params.configName;
    var configValue = req.params.configValue;
    if(configName == undefined || configValue == undefined || configName == null || configValue == null) {
        this.buildResponse(res, false, 500, 'No config value or config name specified');
    }
    if(this.getConfigSetting(configName)==undefined) {
        this.buildResponse(res, false, 404, "Unknown config value");        
    }
    this.setConfigSetting(configName, configValue);
}

ISYServer.prototype.loadConfig = function() {
    var fileData = fs.readFileSync('./example-nodes.xml', 'ascii');
    this.rootDoc = new parser().parseFromString(fileData.substring(2, fileData.length));
    
    // Load folders
    var folders  = this.rootDoc.getElementsByTagName('folder');
    for(var i = 0; i < folders.length; i++) {
        var newNode = new FolderNode(folders[i]);
        this.nodeIndex[newNode.getAddress()] = newNode;
    }    
    
    // Load devices
    var devices = this.rootDoc.getElementsByTagName('node');
    for(var j = 0; j < devices.length; j++) {
        var newNode = new DeviceNode(devices[j]);
        if(newNode.getType() == '4.15.1.0') {
            continue;
        }
        this.nodeIndex[newNode.getAddress()] = newNode;
    }
    
}

ISYServer.prototype.authHandler = function (req, res, next) {
    function unauthorized(res) {
        res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
        return res.sendStatus(401);
    };

    var user = basicAuth(req);

    if(!this.getConfigSetting(this.CONFIG_REQUIRE_AUTH)) {
        return next();
    }

    if (!user || !user.name || !user.pass) {
        return unauthorized(res);
    }

    if (user.name === this.getConfigSetting(this.CONFIG_USERNAME) && user.pass === this.getConfigSetting(this.CONFIG_PASSWORD)) {
        return next();
    } else {
        return unauthorized(res);
    }
}

ISYServer.prototype.configureRoutes = function() {
    var that = this;
    
    this.app.get('/config/:configName/:configValue', function(req, res) {
        that.handleConfigureRequest(req,res);
    });

    this.app.get('/rest/nodes/:address/cmd/:command/:parameter', this.authHandler.bind(this), function (req, res) {
        that.handleCommandRequest(req,res);
    });

    this.app.get('/rest/nodes/:address/cmd/:command', this.authHandler.bind(this), function (req, res) {
        that.handleCommandRequest(req,res);
    });
    
    this.app.get('/rest/nodes', this.authHandler.bind(this), function (req, res) {
        that.hadleNodesRequest(req,res);
    });

    this.app.get('/rest/elk/get/topology', this.authHandler.bind(this), function (req, res) {
        if(!that.getConfigSetting(that.CONFIG_ELK_ENABLED)) {
            res.status(500).send('Elk is disabled');
        } else {
            res.send('Elk topology');
        }
    });

    this.app.get('/rest/elk/get/status', this.authHandler.bind(this), function (req,res)  {
        if(!that.getConfigSetting(that.CONFIG_ELK_ENABLED)) {
            res.status(500).send('Elk is disabled');
        } else {
            res.send('Elk status');
        }
    });
        
}

ISYServer.prototype.start = function() {
    this.loadConfig();
    this.configureRoutes();
    var server = this.app.listen(this.port, function () {
        var host = server.address().address;
        var port = server.address().port;

        console.log('fake-isy-994i app listening at http://%s:%s', host, port);
    });    
}

var host = new ISYServer(3000);
host.start();


