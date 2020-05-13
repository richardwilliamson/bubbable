/*
* (C) Copyright 2014-2015 Kurento (http://kurento.org/)
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
*/
var MIN_VIDEO_BANDWIDTH = 0;
var MAX_VIDEO_BANWIDTH = 5000;

var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');
var ffmpeg = require('fluent-ffmpeg');

//const tmp = require('tmp');

var argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: 'https://localhost:8443/',
    ws_uri: 'ws://localhost:8888/kurento'
  }
});

var options =
{
  key:  fs.readFileSync('keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
* Definition of global variables.
*/
var idCounter = 0;
//var candidatesQueue = {};
//var previewCandidatesQueue = {};
var kurentoClient = null;
var gallerys = [];
var programmes = [];

var webcams = [];
var screens = [];
var previews = [];
var facebookRtp = null;
var youTubeRtp = null;

var currentPreview = {};
var currentProgramme = {};

var composite;
var dispatcher;
var mediaPipeline;

// var rtp;
// var http;

/*
* Server startup
*/
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
  console.log('Kurento Tutorial started');
  console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
  server : server,
  path : '/one2many'
});

function nextUniqueId() {
  idCounter++;
  return idCounter.toString();
}

/*
* Management of WebSocket messages
*/
wss.on('connection', function(ws) {
  var sessionId = nextUniqueId();
  console.log('Connection received with sessionId ' + sessionId);

  ws.on('error', function(error) {
    console.log('Connection ' + sessionId + ' error');
    stop(sessionId);
  });

  ws.on('close', function() {
    console.log('Connection ' + sessionId + ' closed');
    stop(sessionId);
  });

  ws.on('message', function(_message) {
    var message = JSON.parse(_message);
    //console.log('Connection ' + sessionId + ' received message ');

    switch (message.id) {
      case 'webcam':
      startWebcam(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
        if (error) {
          return ws.send(JSON.stringify({
            id : 'webcamResponse',
            response : 'rejected',
            message : error
          }));
        }
        ws.send(JSON.stringify({
          id : 'webcamResponse',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });
      break;

      case 'screen':
      startScreen(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
        if (error) {
          return ws.send(JSON.stringify({
            id : 'screenResponse',
            response : 'rejected',
            message : error
          }));
        }
        ws.send(JSON.stringify({
          id : 'screenResponse',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });
      break;

      case 'gallery':
      startGallery(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
        if (error) {
          return ws.send(JSON.stringify({
            id : 'galleryResponse',
            response : 'rejected',
            message : error
          }));
        }

        ws.send(JSON.stringify({
          id : 'galleryResponse',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });
      break;
      case 'programme':
      startProgramme(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
        if (error) {
          return ws.send(JSON.stringify({
            id : 'programmeResponse',
            response : 'rejected',
            message : error
          }));
        }

        ws.send(JSON.stringify({
          id : 'programmeResponse',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });
      break;
      case 'preview':
      console.log("----START PREVIEW WINDOW-----");
      startPreview(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
        console.log("started previewer");
        if (error) {
          return ws.send(JSON.stringify({
            id : 'previewResponse',
            response : 'rejected',
            message : error
          }));
        }

        ws.send(JSON.stringify({
          id : 'preiewResponse',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });
      break;
      case 'broadcast-fb':
        createFacebookRtpEndpoint(); //this also creates the ffmpeg sender
      break;
      case 'broadcast-yt':
        createYouTubeRtpEndpoint(); //this also creates the ffmpeg sender
      break;

      case 'stop':
      console.log("GOT A STOP");
      stop(sessionId);
      break;

      case 'onGalleryIceCandidate':
      console.log("g");
      onIceCandidate(sessionId, message.candidate, gallerys[sessionId]);
      break;
      console.log("w");
      case 'onWebcamIceCandidate':
      onIceCandidate(sessionId, message.candidate, webcams[sessionId]);
      break;
      console.log("p");
      case 'onProgrammeIceCandidate':
      onIceCandidate(sessionId, message.candidate, programmes[sessionId]);
      break;
      console.log("s");
      case 'onScreenIceCandidate':
      onIceCandidate(sessionId, message.candidate, screens[sessionId]);
      break;

      // case 'onIceCandidate':
      // onIceCandidate(sessionId, message.candidate, previews[sessionId]);
      // break;

      case 'selectChannel':
      onSelectChannel(message.type, message.channel, message.target);
      break;
      case 'take':
      onTake();
      break;

      default:
      ws.send(JSON.stringify({
        id : 'error',
        message : 'Invalid message ' + message
      }));
      console.log("unexpected message "+message.id);
      break;
    }
  });
});

/*
* Definition of functions
*/

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }

  kurento(argv.ws_uri, function(error, _kurentoClient) {
    if (error) {
      console.log("Could not find media server at address " + argv.ws_uri);
      return callback("Could not find media server at address" + argv.ws_uri
      + ". Exiting with error " + error);
    }

    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}
// Retrieve or create mediaPipeline
function getMediaPipeline( callback ) {

  if ( mediaPipeline ) {
    console.log("MediaPipeline already created ");
    return callback( null, mediaPipeline );
  }
  getKurentoClient(function(error, _kurentoClient) {
    if (error) {
      console.log("error getting client "+error);
      return callback(error);
    }
    _kurentoClient.create( 'MediaPipeline', function( error, _pipeline ) {
      console.log("creating MediaPipeline");
      if (error) {
        return callback(error);
      }
      mediaPipeline = _pipeline;
      callback(null, mediaPipeline);
    });
  });
}


// Retrieve or create dispatcher hub
function getDispatcher( callback ) {
  if ( dispatcher ) {
    console.log("Composer already created");
    return callback( null, dispatcher, mediaPipeline );
  }
  getMediaPipeline( function( error, _pipeline) {
    if (error) {
      return callback(error);
    }
    _pipeline.create( 'Dispatcher',  function( error, _dispatcher ) {
      console.log("creating dispatcher");
      if (error) {
        return callback(error);
      }
      dispatcher = _dispatcher;
      callback( null, dispatcher );
    });
  });
}

// Create a hub port
function createDispatcherHubPort(callback) {
  getDispatcher(function(error, _dispatcher) {
    if (error) {
      return callback(error);
    }
    _dispatcher.createHubPort( function(error, _hubPort) {
      console.info("Creating hubPort");
      if (error) {
        return callback(error);
      }
      callback( null, _hubPort );
    });
  });
}

// Retrieve or create composite hub
function getComposite( callback ) {
  if ( composite && composite.composite) {
    console.log("Composite already created");
    return callback( null, composite.composite, mediaPipeline );
  }
  composite = {
    composite: null,
    type: 'composite',
    dispatcherHubPort: null
  }
  getMediaPipeline( function( error, _pipeline) {
    if (error) {
      return callback(error);
    }
    _pipeline.create( 'Composite',  function( error, _composite ) {
      console.log("creating Composite");
      if (error) {
        return callback(error);
      }
      composite.composite = _composite;
      createCompositeHubPort(composite, _pipeline, function (error, _compHubPort){
          createDispatcherHubPort(function (error, _dispHubPort) {
            if (error) {
              stop(type);
              console.log("Error creating HubPort " + error);
              return callback(error);
            }
            console.log("got dispatcher hub for composite");
            composite.dispatcherHubPort = _dispHubPort;
            composite.compositeHubPort = _compHubPort;

            composite.dispatcherHubPort.connect(composite.compositeHubPort);
            composite.compositeHubPort.connect(composite.dispatcherHubPort);
            console.log("done that");
            callback( null, composite.composite );

          });
      });
      //callback( null, composite.composite );

    });
  });
}

// Create a hub port
function createCompositeHubPort(item, pipeline, callback) {
  getComposite(function(error, _composite) {
    console.log("here"+error);
    if (error) {
      return callback(error);
    }
    console.log("comp is"+_composite);

    _composite.createHubPort( function(error, _hubPort) {
      console.info("Creating hubPort");
      if (error) {
        return callback(error);
      }
      if (item.type == 'gallery' || item.type == 'composite') //gallery doesn't have a text overlay
      return callback(null, _hubPort, null);

      pipeline.create('GStreamerFilter', {
        command: 'textoverlay font-desc="Sans 24" text="'+item.name+'" valignment=top halignment=left shaded-background=true'
      }, function(error, filter) {
        if (error)
        {
          return callback(error);
        }
        console.log("error"+error+"filter"+filter);
        return callback(null, _hubPort, filter);

      });


    });
  });
}

var doneFirst = false;
// Create a webRTC end point
function createWebRtcEndPoint (item, sessionId, sdpOffer, ws, type, callback) {
  getMediaPipeline( function( error, _pipeline) {
    if (error) {
      console.log("ERROR GETTING PIPELINE "+error);
      abort();
      return callback(error);
    }
    _pipeline.create('WebRtcEndpoint',  function( error, _webRtcEndpoint ) {
      console.info("Creating createWebRtcEndpoint");
      if (error) {
        console.log("error creating ep"+error);
        stop(sessionId);
        return callback(error);
      }
      console.log("here "+item.type);
      if (item.type == 'webcam' && !doneFirst)
      {
        console.log("DONE FIRST");
        _webRtcEndpoint.setMinVideoRecvBandwidth(MIN_VIDEO_BANDWIDTH);
        _webRtcEndpoint.setMaxVideoRecvBandwidth(MAX_VIDEO_BANWIDTH);
        _webRtcEndpoint.setMinVideoSendBandwidth(MIN_VIDEO_BANDWIDTH);
        _webRtcEndpoint.setMaxVideoSendBandwidth(MAX_VIDEO_BANWIDTH);
        doneFirst = true;
      }


      if (item.queuedConnections) {
        while(item.queuedConnections.length) {
          console.log("un-queueing candidate "+type);
          var candidate = item.queuedConnections.shift();
          _webRtcEndpoint.addIceCandidate(candidate);
        }
      }

      _webRtcEndpoint.on('OnIceCandidate', function(event) {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        ws.send(JSON.stringify({
          id : type+'IceCandidate',
          candidate : candidate
        }));
      });
      _webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
        if (error) {
          console.log("error processing offer"+error);
          stop(sessionId);
          return callback(error);
        }

        if (error) {
          return ws.send(JSON.stringify({
            id : type+'Response',
            response : 'rejected',
            message : error
          }));
        }
        ws.send(JSON.stringify({
          id : type+'Response',
          response : 'accepted',
          sdpAnswer : sdpAnswer
        }));
      });

      _webRtcEndpoint.gatherCandidates(function(error) {
        if (error) {
          console.log("error gathering "+error);
          stop(sessionId);
          return callback(error);
        }
      });
      if (type != 'preview' && type != 'programme')
      {
        createCompositeHubPort(item, _pipeline, function (error, _hubPort, _textOverlay) {
          if (error) {
            stop(sessionId);
            console.log("Error creating HubPort " + error);
            return callback(error);
          }
          console.log("got hub for "+sessionId);
          item.compositeHubPort = _hubPort;

          // item.textOverlay = _textOverlay;
          if (item.type != 'gallery')
          { //ADD IN THE TEXT OVERLAY ON THE FEED INTO THE GALLERY
            //item.webRtcEndpoint.connect(item.compositeHubPort);
            item.webRtcEndpoint.connect(_textOverlay);
            _textOverlay.connect(item.compositeHubPort);
          } else { //we are gallery
            //link the output from the composite to the input to the composite viewer
            item.compositeHubPort.connect(item.webRtcEndpoint);
          }
        });
      }

      if (item.type != 'gallery')
      {
        createDispatcherHubPort(function (error, _hubPort) {
          if (error) {
            stop(type);
            console.log("Error creating HubPort " + error);
            return callback(error);
          }
          console.log("got dispatcher hub for "+sessionId+" "+type);
          item.dispatcherHubPort = _hubPort;
          if (type != 'preview' && type != 'programme' && type != 'gallery') //an input to the hubPort
          item.webRtcEndpoint.connect(item.dispatcherHubPort);
          else //an output from the port
          item.dispatcherHubPort.connect(item.webRtcEndpoint);

          console.log("maybe hook up");
          if (item.type == 'preview')
          {
            console.log("am preview");
            if (currentPreview && currentPreview.endpoint)
            {
              console.log("hook up");
              dispatcher.connect(currentPreview.endpoint.dispatcherHubPort, item.dispatcherHubPort);

            }
          }
          if (item.type == 'programme')
          {
            if (currentProgramme && currentProgramme.endpoint)
            {
              dispatcher.connect(currentProgramme.endpoint.dispatcherHubPort, item.dispatcherHubPort);

            }
          }
        });
      }

      return callback( null, _webRtcEndpoint );
    });

  });

}

function onSelectChannel( type, channel, target, callback)
{
  if (!type)
    return;
  var dest;
  var message = "";
  if (type == 'gallery')
  {
    dest = composite;
  } else if (type == 'webcam')
  {
    if (!webcams[channel])
    {
      console.log("no webcam for "+channel);
      //callback("no such webcam"+channel);
      return;
    } else {
      message = "selecting camera "+channel;
      dest = webcams[channel];
    }
  } else if (type == 'screen')
  {
    if (!screens[channel])
    {
      console.log("no screen for "+channel);
      //callback("no such screen"+channel);
      return;
    } else {
      message = "selecting screen "+channel;
      dest = screens[channel];

    }


  }
  if (target == 'preview' && previews.length)
  {
    console.log("selecting for preview..")
    for (var i=0; i<previews.length; i++)
    {
      if (previews[i])
        dispatcher.connect(dest.dispatcherHubPort, previews[i].dispatcherHubPort);
    }
    currentPreview = {
      type: type,
      channel: channel,
      endpoint: dest
    };
  }

  if (target == 'programme')
  {
    programmes.forEach(function(value, index, array){
      if (value)
      {
        dispatcher.connect(dest.dispatcherHubPort, value.dispatcherHubPort);
      }
    });
    if(facebookRtp)
    {
      console.log("selecting for broadcast FB");
      dispatcher.connect(dest.dispatcherHubPort, facebookRtp.dispatcherHubPort);
    }
    if(youTubeRtp)
    {
      console.log("selecting for broadcast YT");
      dispatcher.connect(dest.dispatcherHubPort, youTubeRtp.dispatcherHubPort);
    }
    currentProgramme = {
      type: type,
      channel: channel,
      endpoint: dest
    };
  }
  //we just send these to gallerys as we assume that those are the clients that want them..
  gallerys.forEach(function(value, index, array) {
    value.ws.send(JSON.stringify({
      id: 'switcherResponse',
      response: 'accepted',
      type: type,
      channel: channel,
      target: target

    }))
  });



  console.log("Sent switch "+type+channel+target);

  if (callback)
  callback();
}
function updateSources() {
  if (gallerys)
  {
    var sources = [];
    for (var i=0; i<webcams.length; i++)
    {
      if (webcams[i])
      {
        sources.push({
          id: webcams[i].id,
          type: 'webcam',
          name: 'webcam'+webcams[i].id,
          previewSelected: (currentPreview && currentPreview.type == 'webcam' && currentPreview.channel == webcams[i].id),
          programmeSelected: (currentProgramme && currentProgramme.type == 'webcam' && currentProgramme.channel == webcams[i].id)

        })
      }
    }
    for (var i=0; i<screens.length; i++)
    {
      if (screens[i])
      {
        sources.push({
          id: screens[i].id,
          type: 'screen',
          name: 'screen'+screens[i].id,
          previewSelected: (currentPreview && currentPreview.type == 'screen' && currentPreview.channel == screens[i].id),
          programmeSelected: (currentProgramme && currentProgramme.type == 'screen' && currentProgramme.channel == screens[i].id)

        })
      }
    }

    sources.push( {
      id: 0,
      type: 'gallery',
      name: 'gallery',
      previewSelected: (currentPreview && currentPreview.type == 'gallery'),
      programmeSelected: (currentProgramme && currentProgramme.type == 'gallery')
    })
    gallerys.forEach(function(value, index, array) {

      value.ws.send(JSON.stringify({
        id: 'sourcesUpdated',
        message: sources,
      }));
    });
  }
}

function onTake()
{
  if (!currentPreview || !currentProgramme)
  return;

  console.log("doing take");

  var oldProg = currentProgramme;

  onSelectChannel(currentPreview.type, currentPreview.channel, 'programme', function() {
    onSelectChannel(oldProg.type, oldProg.channel, 'preview');
  });
}

function startPreview(sessionId, ws, sdpOffer, callback) {
  console.log("GOT START PREVIEW");

  previews[sessionId] = {
    id : sessionId,
    type: 'preview',
    webRtcEndpoint : null,
    dispatacherHubPort: null,
    ws : ws,
    queuedConnections : []
  }

  createWebRtcEndPoint(previews[sessionId], sessionId, sdpOffer, ws, 'preview', function (error, ep) {
    if (error) {
      console.log("error creating end point" + error);
      return callback(error);
    }
    console.log("GOT PREVIEW EP "+ep.constructor.name);
    previews[sessionId].webRtcEndpoint = ep;

    return callback(null);

  });
}

function startGallery(sessionId, ws, sdpOffer, callback) {
  //clearCandidatesQueue(sessionId);
  console.log("GOT START GALLERY");
  // if (gallery !== null) {
  //   stop(sessionId);
  //   return callback("Another user is currently acting as presenter. Try again later ...");
  // }

  gallerys[sessionId] = {
    id : sessionId,
    type : 'gallery',
    webRtcEndpoint : null,
    compositeHubPort : null,
    ws : ws,
    queuedConnections : []
  }

  createWebRtcEndPoint(gallerys[sessionId], sessionId, sdpOffer, ws, 'gallery', function (error, ep) {
    if (error) {
      console.log("error creating end point" + error);
      return callback(error);
    }
    console.log("GOT GALLERY EP "+ep.constructor.name);
    gallerys[sessionId].webRtcEndpoint = ep;
    updateSources(); //send available cameras to the gallery
  });
}


function startProgramme(sessionId, ws, sdpOffer, callback) {
  //clearCandidatesQueue(sessionId);
  console.log("GOT START PROGRAMME");
  // if (programme !== null) {
  //   stop(sessionId);
  //   return callback("Another user is currently acting as presenter. Try again later ...");
  // }

  programmes[sessionId] = {
    id : sessionId,
    type: 'programme',
    webRtcEndpoint : null,
    compositeHubPort : null,
    ws : ws,
    queuedConnections : []
  }

  createWebRtcEndPoint(programmes[sessionId], sessionId, sdpOffer, ws, 'programme', function (error, ep) {
    if (error) {
      console.log("error creating end point" + error);
      return callback(error);
    }
    console.log("GOT PROGRAMME EP "+ep.constructor.name);
    programmes[sessionId].webRtcEndpoint = ep;


  });
}

function startWebcam(sessionId, ws, sdpOffer, callback) {
  //clearCandidatesQueue(sessionId);

  webcams[sessionId]  = {
    id : sessionId,
    name : 'webcam '+sessionId,
    type: 'webcam',
    webRtcEndpoint : null,
    compositeHubPort: null,
    dispatacherHubPort: null,
    ws : ws,
    queuedConnections: []
  }
  createWebRtcEndPoint(webcams[sessionId], sessionId, sdpOffer, ws, 'webcam', function (error, _webRtcEndpoint) {
    if (error) {
      console.log("error creating end point" + error);
      return callback(error);
    }
    console.log("created source end point ");

    webcams[sessionId].webRtcEndpoint = _webRtcEndpoint;
    updateSources();

  });
}


function startScreen(sessionId, ws, sdpOffer, callback) {
  //clearCandidatesQueue(sessionId);

  screens[sessionId]  = {
    id : sessionId,
    name: 'screen '+sessionId,
    webRtcEndpoint : null,
    compositeHubPort: null,
    dispatacherHubPort: null,
    ws : ws,
    queuedConnections: []
  }
  createWebRtcEndPoint(screens[sessionId], sessionId, sdpOffer, ws, 'screen', function (error, _webRtcEndpoint) {
    if (error) {
      console.log("error creating screen end point" + error);
      return callback(error);
    }
    console.log("created source end point ");
    screens[sessionId].webRtcEndpoint = _webRtcEndpoint;
    updateSources();



  });
}


function stop(sessionId) {
  console.log("stop "+sessionId);
  // if (gallery && gallery.sessionId == sessionId)
  // {
  //   gallery.ws.send(JSON.stringify({ id : 'stopCommunication' }));
  //   delete gallery;
  // }

  if (gallerys[sessionId]) {
    gallerys[sessionId].webRtcEndpoint.release();
    if (gallerys[sessionId].dispatcherHubPort)
      gallerys[sessionId].dispatcherHubPort.release();
    gallerys[sessionId].compositeHubPort.release();
    delete gallerys[sessionId];
    updateSources();
  }

  if (programmes[sessionId]) {
    programmes[sessionId].webRtcEndpoint.release();
    programmes[sessionId].dispatcherHubPort.release();
    if (programmes[sessionId].compositeHubPort)
      programmes[sessionId].compositeHubPort.release();
    delete webcams[sessionId];
    updateSources();
  }
  if (webcams[sessionId]) {
    webcams[sessionId].webRtcEndpoint.release();
    webcams[sessionId].dispatcherHubPort.release();
    webcams[sessionId].compositeHubPort.release();
    delete webcams[sessionId];
    updateSources();
  }
  if (previews[sessionId])
  {
    previews[sessionId].webRtcEndpoint.release();
    if (previews[sessionId].dispatcherHubPort)
    previews[sessionId].dispatcherHubPort.release();
    delete previews[sessionId];

  }
  if (screens[sessionId]) {
    screens[sessionId].webRtcEndpoint.release();
    screens[sessionId].dispatcherHubPort.release();
    screens[sessionId].compositeHubPort.release();
    delete screens[sessionId];
    updateSources();
  }


  if (webcams.length < 1 && !gallerys) {
    console.log('NEED TO CLOSE kurento client');
    // getKurentoClient.close();
    // kurentoClient = null;
  }
}


function onIceCandidate(sessionId, _candidate, item) {
  var candidate = kurento.getComplexType('IceCandidate')(_candidate);
  //console.log("****GOT ICE candidate" + sessionId);
  if (!item)
  {
    console.log("!!!!NO ITEM FOR ICE CANDIDATE");
    return;
  }
  if (item.id != sessionId)
  {
    console.log("!!!!!!!incorrect session id");
    return;
  }
  if (item.webRtcEndpoint) {
    //console.info('Sending gallery candidate');
    console.log("adding ice candidate");
    item.webRtcEndpoint.addIceCandidate(candidate);
  }
  else {
    console.info('^&^&*^*&^&*^&*^&*^&*^&*^* Queueing candidate');
    item.queuedConnections.push(candidate);
  }
}




function createFacebookRtpEndpoint() {
  if (facebookRtp) {
    console.log("rtp endpoint exists");
    return;
  }
  facebookRtp = {
    rtp : null,
    compositeHubPort: null,
    dispatcherHubPort:  null
  }
  getMediaPipeline( function(error, _pipeline) {
    if (error)
    {
      console.log("error getting pipeline rtp "+error);
      return;
    }
    console.log("*******creating rtp endpoint*******");
    _pipeline.create('RtpEndpoint', onCreateFacebookRtpEndpoint);
  });
}

function onCreateFacebookRtpEndpoint(error, _rtp) {
  if (error) return onError(error);

  facebookRtp.rtp = _rtp;

  // _rtp.on('EndOfStream', function(event){
  //     console.log("GOT RTP END OF STREAM "+event);
  // });

  _rtp.on('ElementConnected', function(event){
    console.log("GOT PV ElementConnected"+event);
  });
  _rtp.on('MediaSessionStarted', function(event){
    console.log("GOT PV MediaSessionStarted"+event);
  });

  _rtp.on('MediaStateChanged', function(event){
    console.log("GOT PV MediaStateChanged"+event+event.newState+event.constructor.name);
  });
  _rtp.on('MediaFlowInStateChange', function(event){
    console.log("GOT PV MediaFlowInStateChange"+event+event.state+event.constructor.name);
    startFacebookFfmpeg();
    console.log("********STARTED FFMPEG*********");
  });

  _rtp.on('MediaFlowOutStateChange', function(event){
    console.log("GOT PV MediaFlowOutStateChange"+event+event.state+event.constructor.name);
  });

  _rtp.on('ConnectionStateChanged', function(event){
    console.log("GOT PV ConnectionStateChanged"+event);
  });

  _rtp.on('MediaTranscodingStateChange', function(event){
    console.log("GOT PV MediaTranscodingStateChange"+event);
  });

  sdp_rtp = '';
  sdp_rtp += 'v=0\r\n';
  sdp_rtp += 'o=- 0 0 IN IP4 127.0.0.1\r\n';
  sdp_rtp += 's=Kurento Tutorial - RTP Receiver\r\n';
  sdp_rtp += 'c=IN IP4 127.0.0.1\r\n';
  sdp_rtp += 't=0 0\r\n';
  sdp_rtp += "m=audio 5004 RTP/AVPF 96\r\n"
  sdp_rtp += "a=rtpmap:96 opus/48000/2\r\n"
  sdp_rtp += "a=ssrc:445566 cname:user@example.com\r\n";
  sdp_rtp += 'm=video 5006 RTP/AVPF 103\r\n';
  sdp_rtp += 'a=rtpmap:103 H264/90000\r\n';
  sdp_rtp += 'a=rtcp-fb:103 goog-remb\r\n';
  sdp_rtp += 'a=ssrc:112233 cname:user@example.com\r\n'
  sdp_rtp += "";

  console.log(sdp_rtp);


  _rtp.processOffer(sdp_rtp, onFacebookRtpProcessOffer);
}

function onFacebookRtpProcessOffer(error, sdpAnswer) {
  if (error) {
    console.log("error processing facebook offer"+error)
    return;
  }
  console.log("*********PROCESSING PREVIEW RTP OFFER**********" + sdpAnswer);

  createDispatcherHubPort(function (error, _hubPort) {
    if (error) {
      stop(id);
      console.log("Error creating HubPort " + error);
      return callback(error);
    }
    console.log("got displatcher hub for rtp preview ");
    facebookRtp.dispatcherHubPort = _hubPort;
    //rtp.rtp.connect(rtp.dispatcherHubPort);

    facebookRtp.dispatcherHubPort.connect(facebookRtp.rtp, function(error) {
      if (error) {
        console.log("error connecting preview rtp to port");
        return;
      }
      //dispatcher.connect(webcams[1].dispatcherHubPort, facebookRtp.dispatcherHubPort);
      console.log("connected to port NEED TO  selected");

    });

  });
}

var startedFacebook = false;
function startFacebookFfmpeg()
{
  //console.log("&&&&&& DISABLED FFMPEG&&&&&");
  //return;
  var fb_url = 'rtmps://live-api-s.facebook.com:443/rtmp/';
  var fb_key = '2613969272218122?s_bl=1&s_ps=1&s_sw=0&s_vt=api-s&a=AbwtTj-PfNxrbzqfcg8';

  if (startedFacebook) return;
  startedFacebook = true;
  console.log("******STARTING PROPERLY******");
  var process = new ffmpeg('facebookSdp.sdp')
  //.native() //.re
  .inputOption('-protocol_whitelist', 'file,http,https,tcp,tls,udp,rtp')
  .audioCodec('aac')
  .audioFrequency(44100) //-ar
  .audioBitrate('128k') //video.addCommand('-b:a', '128k');
  .outputOption('-pix_fmt', 'yuv420p')
  .outputOption('-profile:v', 'baseline')
  .size('640x480') //video.addCommand('-s', '426x240');
  .outputOption('-bufsize', '6000k')
  .outputOption('-vb', '800k')
  .outputOption('-maxrate', '4000k')
  .outputOption('-deinterlace')
  .videoCodec('libx264') //video.setVideoCodec('h264');
  .outputOption('-preset', 'veryfast')//'veryfast') //video.addCommand('-preset', 'veryfast');
  .outputOption('-g', 30)
  .outputOption('-r', 30)
  .outputOption('-threads', 8)
  .outputOption('-max_muxing_queue_size', 800)
  .format('flv')
  .output(fb_url + fb_key)
  .on('end', function() {
    console.log('Finished processing');
  })
  .on('start', function() {
    console.log('started');
  })
  .on('error', function(error) {
    console.log("got an error "+error);
    startedFacebook = false;
  })
  .on('stderr', function(stderrLine) {
    console.log('Stderr output: ' + stderrLine);
  })
  .on('progress', function(progress){
    console.log("got progress Frames:"+progress.frames+" FPS:"+progress.currentFps);
  })
  .on('start', function(commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
  .on('end', function(stdout, stderr) {
    console.log("ffmpeg ended");
    startedFacebook = false;
  })
  .run();; // video.addCommand('-f', 'flv');

}
function createYouTubeRtpEndpoint() {
  if (youTubeRtp) {
    console.log("rtp endpoint exists");
    return;
  }
  youTubeRtp = {
    rtp : null,
    compositeHubPort: null,
    dispatcherHubPort:  null
  }
  getMediaPipeline( function(error, _pipeline) {
    if (error)
    {
      console.log("error getting pipeline rtp "+error);
      return;
    }
    console.log("*******creating rtp endpoint*******");
    _pipeline.create('RtpEndpoint', onCreateYouTubeRtpEndpoint);
  });
}

function onCreateYouTubeRtpEndpoint(error, _rtp) {
  if (error) return onError(error);

  youTubeRtp.rtp = _rtp;
  youTubeRtp.rtp.setMinVideoSendBandwidth(MIN_VIDEO_BANDWIDTH);
  youTubeRtp.rtp.setMaxVideoSendBandwidth(MAX_VIDEO_BANWIDTH);


  // _rtp.on('EndOfStream', function(event){
  //     console.log("GOT RTP END OF STREAM "+event);
  // });

  _rtp.on('ElementConnected', function(event){
    console.log("GOT PV ElementConnected"+event);
  });
  _rtp.on('MediaSessionStarted', function(event){
    console.log("GOT PV MediaSessionStarted"+event);
  });

  _rtp.on('MediaStateChanged', function(event){
    console.log("GOT PV MediaStateChanged"+event+event.newState+event.constructor.name);
  });
  _rtp.on('MediaFlowInStateChange', function(event){
    console.log("GOT PV MediaFlowInStateChange"+event+event.state+event.constructor.name);
    startYouTubeFfmpeg();
    console.log("********STARTED FFMPEG YOUTUBE*********");
  });

  _rtp.on('MediaFlowOutStateChange', function(event){
    console.log("GOT PV MediaFlowOutStateChange"+event+event.state+event.constructor.name);
  });

  _rtp.on('ConnectionStateChanged', function(event){
    console.log("GOT PV ConnectionStateChanged"+event);
  });

  _rtp.on('MediaTranscodingStateChange', function(event){
    console.log("GOT PV MediaTranscodingStateChange"+event);
  });
  sdp_rtp = fs.readFileSync('facebookSdp.sdp').toString('utf8');
  console.log("got sdp "+sdp_rtp);
  // sdp_rtp = '';
  // sdp_rtp += 'v=0\r\n';
  // sdp_rtp += 'o=- 0 0 IN IP4 127.0.0.1\r\n';
  // sdp_rtp += 's=Kurento Tutorial - RTP Receiver\r\n';
  // sdp_rtp += 'c=IN IP4 127.0.0.1\r\n';
  // sdp_rtp += 't=0 0\r\n';
  // sdp_rtp += "m=audio 5004 RTP/AVPF 96\r\n"
  // sdp_rtp += "a=rtpmap:96 opus/48000/2\r\n"
  // sdp_rtp += "a=ssrc:445566 cname:user@example.com\r\n";
  // sdp_rtp += 'm=video 5006 RTP/AVPF 103\r\n';
  // sdp_rtp += 'a=rtpmap:103 H264/90000\r\n';
  // sdp_rtp += 'a=rtcp-fb:103 goog-remb\r\n';
  // sdp_rtp += 'a=ssrc:112233 cname:user@example.com\r\n'
  // sdp_rtp += "";



  _rtp.processOffer(sdp_rtp, onYouTubeRtpProcessOffer);
}

function onYouTubeRtpProcessOffer(error, sdpAnswer) {
  if (error) {
    console.log("error processing facebook offer"+error)
    return;
  }
  console.log("*********PROCESSING YOUTUBE RTP OFFER**********");

  createDispatcherHubPort(function (error, _hubPort) {
    if (error) {
      stop(id);
      console.log("Error creating HubPort " + error);
      return callback(error);
    }
    console.log("got displatcher hub for rtp preview ");
    youTubeRtp.dispatcherHubPort = _hubPort;
    //rtp.rtp.connect(rtp.dispatcherHubPort);

    youTubeRtp.dispatcherHubPort.connect(youTubeRtp.rtp, function(error) {
      if (error) {
        console.log("error connecting preview rtp to port");
        return;
      }
      //dispatcher.connect(webcams[1].dispatcherHubPort, facebookRtp.dispatcherHubPort);
      console.log("connected to port YT NEED TO  selected");

    });

  });
}

var startedYouTube = false;
function startYouTubeFfmpeg()
{
  console.log("disabled youtube ffmpeg");
  return;
  //console.log("&&&&&& DISABLED FFMPEG&&&&&");
  //return;
  var yt_url = 'rtmp://a.rtmp.youtube.com/live2';
  var yt_key = 'mv28-q328-u2yz-9dzq';

  if (startedYouTube) return;
  startedYouTube = true;
  console.log("******STARTING PROPERLY******");
  var process = new ffmpeg('facebookSdp.sdp')
  //.native() //.re
  .inputOption('-protocol_whitelist', 'file,http,https,tcp,tls,udp,rtp')
  .audioCodec('libmp3lame')
  .audioFrequency(44100) //-ar
  .outputOption('-b:a', '712000')
  //.audioBitrate('128k') //video.addCommand('-b:a', '128k');
  .outputOption('-pix_fmt', 'yuv420p')
  //.outputOption('-profile:v', 'baseline')
  //.size('640x480') //video.addCommand('-s', '426x240');
  .outputOption('-bufsize', '512k')
  .outputOption('-b:v', '50M')
  .outputOption('-qscale', 3) //100best
  //.outputOption('-maxrate', '4000k')
  //.outputOption('-deinterlace')
  .videoCodec('libx264') //video.setVideoCodec('h264');
  .outputOption('-preset', 'fast')//'veryfast') //video.addCommand('-preset', 'veryfast');
  .outputOption('-g', 60)
  .outputOption('-r', 30)
  .outputOption('-threads', 8)
  //.outputOption('-max_muxing_queue_size', 800)
  .format('flv')
  .output(yt_url +'/'+ yt_key)
  .on('end', function() {
    console.log('Finished processing');
  })
  .on('start', function() {
    console.log('started');
  })
  .on('error', function(error) {
    console.log("got an error "+error);
    startedYouTube = false;
  })
  .on('stderr', function(stderrLine) {
    console.log('Stderr output: ' + stderrLine);
  })
  .on('progress', function(progress){
    console.log("got progress Frames:"+progress.frames+" FPS:"+progress.currentFps);
  })
  .on('start', function(commandLine) {
    console.log('Spawned Ffmpeg with command: ' + commandLine);
  })
  .on('end', function(stdout, stderr) {
    console.log("ffmpeg ended");
    startedYouTube = false;
  })
  .run();; // video.addCommand('-f', 'flv');

}



app.use(express.static(path.join(__dirname, 'static')));
