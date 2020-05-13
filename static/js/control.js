var galleryVideo;
var galleryPeer;

var programmeVideo;
var programmePeer;

var previewSourceLabel;
var programmeSourceLabel;
var previewSourceList;

var galleryMediaConstraints = {
  audio: false,
  video: {
    width: 180,
    framerate: 25
  }
};


function doOnLoad() {

  galleryVideo = document.getElementById('galleryVideo');
  programmeVideo = document.getElementById('programmeVideo');

  previewSourceLabel = document.getElementById('previewSourceLabel');
  programmeSourceLabel = document.getElementById('programmeSourceLabel');

  previewSourceList = document.getElementById('previewSourceList');

  document.getElementById('startVideo').addEventListener('click', function() { startVideo(); } );
  document.getElementById('startFacebook').addEventListener('click', function() { startFacebook(); } );
  document.getElementById('startYouTube').addEventListener('click', function() { startYouTube(); } );

  document.getElementById('takeButton').addEventListener('click', function() { take(); } );


  sourceLabel = document.getElementById("sourceLabel");

}

function doOnMessage(parsedMessage)
{
  switch (parsedMessage.id) {
    case 'galleryResponse':
      response(parsedMessage, galleryPeer);
      return true;
    break;
    case 'galleryIceCandidate':
      galleryPeer.addIceCandidate(parsedMessage.candidate);
      return true;
    break;
    case 'programmeResponse':
      response(parsedMessage, programmePeer);
      return true;
    break;
    case 'programmeIceCandidate':
      programmePeer.addIceCandidate(parsedMessage.candidate);
      return true;
    break;
    case 'switcherResponse':
      switcherReponse(parsedMessage);
      return true;
    case 'sourcesUpdated':
      sourcesUpdated(parsedMessage);
      return true;
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function startVideo() {
  preview(function() {
    setTimeout(function() { //DELAY THIS SO PIPELINE HAS TIME TO CREATE
      if (!galleryPeer) {
        showSpinner(galleryVideo);

        var options = {
          remoteVideo: galleryVideo,
          onicecandidate : onGalleryIceCandidate,
          mediaConstraints : galleryMediaConstraints
        }

        galleryPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
          if(error) return onError(error);

          this.generateOffer(onOfferGallery);

          if (!programmePeer) {
            showSpinner(programmeVideo);

            var options = {
              remoteVideo: programmeVideo,
              onicecandidate : onProgrammeIceCandidate,
              mediaConstraints : mediaConstraints
            }

            programmePeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
              if(error) return onError(error);

              this.generateOffer(onOfferProgramme);
            });

          }
        });
      }
    }, 100);
  }); //start preview video

}

function onOfferProgramme(error, offerSdp) {
  if (error) return onError(error)

  var message = {
    id : 'programme',
    sdpOffer : offerSdp
  }
  sendMessage(message);
}

function onProgrammeIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onProgrammeIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}


function onOfferGallery(error, offerSdp) {
  if (error) return onError(error)

  var message = {
    id : 'gallery',
    sdpOffer : offerSdp
  }
  sendMessage(message);
}

function onGalleryIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onGalleryIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function sourcesUpdated(parsedMessage)
{
  previewSourceList.innerHTML = "";
  programmeSourceList.innerHTML = "";

  var sources = parsedMessage.message;
  for (var i=0; i<sources.length; i++)
  {
      addSource(sources[i], previewSourceList, 'preview')

      addSource(sources[i], programmeSourceList, 'programme')


  }

  addSource(s, previewSourceList, 'preview');
  addSource(s, programmeSourceList, 'programme');

}

function addSource(s, parent, target)
{
  var item = document.createElement('li');
  var html = "<a href='#' class='"+target+"SourceItem";
  if ((target == 'preview' && s.previewSelected) ||(target == 'programme' && s.programmeSelected) )
    html += " sourceSelected";

  html += "' id='selector_"+target+"_"+s.type+"_"+s.id+"'>Select "+s.name+" "+s.type+"</a>";
  item.innerHTML = html;
  javaScriptSucks(item, s.type, s.id, target);

  parent.appendChild(item);
  return item;
}


function javaScriptSucks(item, type, id, target) {
  item.addEventListener('click', function() {
    select(type, id, target);
  });
}

function switcherReponse(parsedMessage)
{
  console.log("got respone #selector_"+parsedMessage.target+"_"+parsedMessage.type+"_"+parsedMessage.channel);
  $('.'+parsedMessage.target+'SourceItem').removeClass("sourceSelected");

  $("#selector_"+parsedMessage.target+"_"+parsedMessage.type+"_"+parsedMessage.channel).addClass("sourceSelected");
}

function select( type, channel, target) {
  var message = {
    id: 'selectChannel',
    type: type,
    channel: channel,
    target: target
  }
  sendMessage(message);
}

function take() {
  var message = {
    id: 'take'
  }
  sendMessage(message);
}

function startFacebook() {
  var message = {
    id: 'broadcast-fb'
  }
  sendMessage(message);
}
function startYouTube() {
  var message = {
    id: 'broadcast-yt'
  }
  sendMessage(message);
}

function doDispose() {
  if (galleryPeer) {
    galleryPeer.dispose();
    galleryPeer = null;
  }

}
