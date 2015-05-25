'use strict';
/**
* Module dependencies.
*/
var logger = require('../log.js').getLog('connector');
var mongoose = require('mongoose');
var util = require ('util');

require ('./revents');
require ('./rproposals');
var REvent = mongoose.model('REvent');
var RProposal = mongoose.model('RProposal');

var saveREvent = function(ev,d,s) {
	var revt = new REvent({eventName:ev,eventDate:new Date(),data:d,socket:s});
	revt.save(function(err){ if (err) { logger.error(err); } });
};

exports.initListener = function(cb) {
	// Add initial data to start tail
	var startDate = new Date();
	var initProposal = new RProposal({proposalDate:startDate,proposal:'none'});
	initProposal.save(function(err){ if (err) { logger.error('init: '+err); } });
	// Query with tail
	var stream = RProposal.find({proposalDate:{'$gte':startDate}}).tailable().stream();
	stream.on('data', cb);
};

exports.relayConnector = function(manager) {
	// Receive client events and send to relay system
	manager.rtc.on('r_stream_added', function(data, socket) {
		logger.debug ('r_stream_added from ' + socket + '\n' + util.inspect (data)); 
		data.roomMembers = manager.rtc.rooms[data.room];
		data.roomState = manager.rtc.roomsState[data.room];
		saveREvent('r_stream_added',data,socket.id);
	});
	manager.rtc.on('r_stream_removed', function(data, socket) {
		logger.debug ('r_stream_removed from ' + socket + '\n' + util.inspect (data)); 
		data.roomMembers = manager.rtc.rooms[data.room];
		data.roomState = manager.rtc.roomsState[data.room];
		saveREvent('r_stream_removed',data,socket.id);
	});
	manager.rtc.on('r_should_accept', function(data, socket) {
		saveREvent('r_should_accept',data,socket.id);
	});
	manager.rtc.on('r_update_info', function(data, socket) {
		saveREvent('r_update_info',data,socket.id);
	});
	// This is for testing purposes only
	manager.rtc.on('r_stream_test', function(data, socket) {
		saveREvent('r_stream_test',data,socket.id);
	});
	
	//We also add a eventlistener to on join and out to maintain the users list update
	
	manager.rtc.on  ('join_room',function(data, socket) {
		
		var roomStatus = manager.rtc.roomsState [data.room] || { connections: {}, relay: false};
		manager.rtc.roomsState[data.room] = roomStatus;
		if (roomStatus.relay){
			logger.debug ('join_room ' + socket.id + ' to ' + data.room);
			data.roomState = roomStatus;
			data.roomMembers = manager.rtc.rooms[data.room];
			saveREvent('join_room', data, socket.id);
		}
	});
	
	manager.rtc.on ('room_leave', function (room, socket) {

		var data = {
			'room': room,
			'roomState': manager.rtc.roomsState[room],
			'roomMembers': manager.rtc.rooms[room]
		};
		
		if (data.roomState.relay){
			logger.debug ('room_leave ' + socket.id + ' from ' + room);
			saveREvent ('room_leave', data, socket.id);
		}
	});
	
	manager.rtc.on('update_owner_data', function(data, socket) {
				
			manager.rooms.checkOwner(socket.id, data.room, function() {

			if (manager.rtc.roomsState[data.room].relay !== data.access.relay){
				//Sent the state when relay mode starts and ends. Algorithm will know what to do with this infomration
				manager.rtc.roomsState[data.room].relay = data.access.relay;

				var sendData = {
					'room': data.room,
					'roomState': manager.rtc.roomsState[data.room],
					'roomMembers': manager.rtc.rooms[data.room]
				};
				
				logger.debug ('room information update ' + socket.id + ' from ' + data.room + ' state ' + util.inspect (sendData.roomState));
				saveREvent ('set_initial_state', sendData, socket.id);
			}
		});
				
	});
	
	var errfn = function(err){
		if (err) { logger.error(err); }
	};
	
	// Listen to proposals send it by relay system
	exports.initListener(function(event){
		if (event.proposal.data!==undefined) {
		  	var roomList = manager.rtc.rooms[event.proposal.data.room] || [];
		  	for ( var i = 0; i < roomList.length; i+=1) {
		  		var id = roomList[i];
		  		if (id === event.proposal.data.target) {
		  			var soc = manager.rtc.getSocket(id);
		  			if (soc) {
		  				soc.send(JSON.stringify({
		  					'eventName' : 'r_proposal',
		  					'data': { 'offers' : event.proposal.data.offers }
		  				}), errfn);
		  			}
		  		}
		  	}
		}
	});
};

// This should be run in a separated process later
require('./relay');