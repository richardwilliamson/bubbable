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

var ws = new WebSocket('wss://' + location.host + '/one2many');
var previewVideo;
var previewPeer;

var mediaConstraints = {
  audio: true,
  video: {
    width: 180,
    framerate: 25
  }
};

window.onload = function() {
  console = new Console();
  previewVideo = document.getElementById('previewVideo');

  //document.getElementById('startPreview').addEventListener('click', function() { preview(); } );
  document.getElementById('terminate').addEventListener('click', function() { stop(); } );

  doOnLoad();
}

window.onbeforeunload = function() {
  ws.close();
}

ws.onmessage = function(message) {
  var parsedMessage = JSON.parse(message.data);
  console.info('Received message: '+ parsedMessage.id);

  switch (parsedMessage.id) {
    // case 'clientResponse':
    // response(parsedMessage, webRtcPeer);
    // break;
    case 'previewResponse':
    response(parsedMessage, previewPeer);
    break;
    case 'stopCommunication':
    dispose();
    break;
    case 'previewIceCandidate':
    previewPeer.addIceCandidate(parsedMessage.candidate)
    break;
    default:
    if (!doOnMessage(parsedMessage))
      console.error('Unrecognized message', parsedMessage);
  }
}

function response(message, _peer) {
  console.log("got response "+message.response);
  if (message.response != 'accepted') {
    var errorMsg = message.message ? message.message : 'Unknown error';
    console.warn('Call not accepted for the following reason: ' + errorMsg);
    dispose();
  } else {
    _peer.processAnswer(message.sdpAnswer);
  }
}

function preview(callback) {
  console.log("creating preview");
  if (!previewPeer) {
    console.log("creating");
    showSpinner(previewVideo);

    var options = {
      remoteVideo: previewVideo,
      onIceCandidate: onPreviewIceCandidate,
      mediaConstraints : mediaConstraints
    }

    previewPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
      if(error) return onError(error);

      this.generateOffer(onOfferPreview);
      if (callback)
        callback();
    });
  }
}

function onOfferPreview(error, offerSdp) {
  if (error) return onError(error);

  var message = {
    id : 'preview',
    sdpOffer : offerSdp
  };
  sendMessage(message);
}


function onPreviewIceCandidate(candidate) {
  console.log('*****Preview Local Candidate******');

  var message = {
    id : 'onPreviewIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function stop() {
  if (previewPeer) {
    var message = {
      id : 'stop'
    }
    sendMessage(message);
    dispose();
  }
}



function dispose() {
  console.log("&&&&&&DISPOSE CALLED&&&&&");
  if (previewPeer) {
    previewPeer.dispose();
    previewPeer = null;
  }

  //hideSpinner(video);
  console.log("need to hide all the spinners..");

  doDispose();
}

function sendMessage(message) {
  var jsonMessage = JSON.stringify(message);
  console.log('Sending message: ' + jsonMessage);
  ws.send(jsonMessage);
}

var spinners = [];

function showSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    console.log("show spinner"+arguments[i]);
    arguments[i].poster = './img/transparent-1px.png';
    arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
    if (!spinners.includes(arguments[i]))
      spinners.push(arguments[i]);
  }
}

function hideSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].src = '';
    arguments[i].poster = './img/webrtc.png';
    arguments[i].style.background = '';
    if (spinners.includes(arguments[i]))
      spinners.remove(arguments[i]);
  }
}
