
var webcamVideo;
var screenVideo;

var webcamPeer;
var screenPeer;

function doOnLoad() {
  webcamVideo = document.getElementById('webcamVideo');
  screenVideo = document.getElementById('screenVideo');

  document.getElementById('startPreview').addEventListener('click', function() { preview(); } );
  document.getElementById('webcam').addEventListener('click', function() { webcam(); } );
  document.getElementById('screen').addEventListener('click', function() { screen(); } );

}

function doOnMessage(parsedMessage)
{
  switch (parsedMessage.id) {
    case 'webcamResponse':
    response(parsedMessage, webcamPeer);
    return true;
    break;
    case 'screenResponse':
    response(parsedMessage, screenPeer);
    return true;
    break;
    case 'webcamIceCandidate':
    webcamPeer.addIceCandidate(parsedMessage.candidate)
    return true;
    break;
    case 'screenIceCandidate':
    screenPeer.addIceCandidate(parsedMessage.candidate)
    return true;
    break;
    default:
    return false;
  }
}

function webcam() {
  console.log("creating source");
  if (!webcamPeer) {
    showSpinner(webcamVideo);


    var options = {
      localVideo: webcamVideo,
      onIceCandidate: onWebcamIceCandidate,
      mediaConstraints : mediaConstraints
    }

    webcamPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(error) {
      if(error) return onError(error);
      this.generateOffer(onOfferWebcam);
    });
  }
}

function onWebcamIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onWebcamIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function onOfferWebcam(error, offerSdp) {
  if (error) return onError(error);

  var message = {
    id : 'webcam',
    sdpOffer : offerSdp
  };
  sendMessage(message);
}

function screen() {
  console.log("creating screen");
  screenVideo.hidden = false;
  screenVideoLabel.hidden = false;
  if (!screenPeer) {
    showSpinner(screenVideo);


    var options = {
      localVideo: screenVideo,
      onIceCandidate: onWebcamIceCandidate,
      mediaConstraints : mediaConstraints,
      sendSource: window

    }

    screenPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(error) {
      if(error) return onError(error);

      this.generateOffer(onOfferScreen);
    });
  }
}

function onWebcamIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onScreenIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function onOfferScreen(error, offerSdp) {
  if (error) return onError(error);

  var message = {
    id : 'screen',
    sdpOffer : offerSdp
  };
  sendMessage(message);
}

function doDispose() {
  if (webcamPeer) {
    webcamPeer.dispose();
    webcamPeer = null;
  }

  if (screenPeer) {
    screenPeer.dispose();
    screenPeer = null;
  }
}



function  getScreenConstraints(sendSource, callback) {
  console.log("GIT");
  var firefoxScreenConstraints = {
    mozMediaSource: 'window',
    mediaSource: 'window'
  };

  getScreenId(function (error, sourceId, screen_constraints) {
      // error    == null || 'permission-denied' || 'not-installed' || 'installed-disabled' || 'not-chrome'
      // sourceId == null || 'string' || 'firefox'

      if(sourceId && sourceId != 'firefox') {
          screen_constraints = {
              video: {
                  mandatory: {
                      chromeMediaSource: 'screen',
                      maxWidth: 1920,
                      maxHeight: 1080,
                      minAspectRatio: 1.77
                  }
              }
          };

          if (error === 'permission-denied') return alert('Permission is denied.');
          if (error === 'not-chrome') return alert('Please use chrome.');

          if (!error && sourceId) {
              screen_constraints.video.mandatory.chromeMediaSource = 'desktop';
              screen_constraints.video.mandatory.chromeMediaSourceId = sourceId;
          }
      }
      callback(null, screen_constraints);

      //navigator.getUserMedia = navigator.mozGetUserMedia || navigator.webkitGetUserMedia;
      // navigator.getUserMedia(screen_constraints, function (stream) {
      //     document.querySelector('video').src = URL.createObjectURL(stream);
      //
      //     // share this "MediaStream" object using RTCPeerConnection API
      // }, function (error) {
      //   console.error('getScreenId error', error);
      //
      //   alert('Failed to capture your screen. Please check Chrome console logs for further information.');
      //   callback(error);
      // });
  });


}
