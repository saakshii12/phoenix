/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2014 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

// This transport provides a connection between Brackets and a live browser preview via service worker
// as the intermediary. We also rely on an injected script in the browser for the other end of the transport.
/*globals logger, Phoenix*/
define(function (require, exports, module) {


    const LiveDevProtocol      = require("LiveDevelopment/MultiBrowserImpl/protocol/LiveDevProtocol"),
        EventDispatcher = require("utils/EventDispatcher"),
        Metrics = require("utils/Metrics");

    const METRIC_SEND_INTERVAL_MS = 1000;

    let transportMessagesRecvCount = 0,
        transportMessagesSendCount = 0,
        transportMessagesRecvSizeB = 0,
        transportMessagesSendSizeB = 0;

    // mix panel and Google Analytics is sending too many request and seems to not have client side aggregation
    // like core analytics. So we do our own aggregation and send metrics only atmost once a second.
    // We could remove this once we moe fully to core analytics.
    setInterval(()=>{
        if(transportMessagesRecvCount > 0){
            Metrics.countEvent(Metrics.EVENT_TYPE.LIVE_PREVIEW, "message",
                "sendCount", transportMessagesSendCount);
            Metrics.countEvent(Metrics.EVENT_TYPE.LIVE_PREVIEW, "message",
                "recvCount", transportMessagesRecvCount);
            Metrics.countEvent(Metrics.EVENT_TYPE.LIVE_PREVIEW, "message",
                "sentBytes", transportMessagesSendSizeB);
            Metrics.countEvent(Metrics.EVENT_TYPE.LIVE_PREVIEW, "message",
                "recvBytes", transportMessagesRecvSizeB);
            transportMessagesRecvCount = 0;
            transportMessagesSendCount = 0;
            transportMessagesRecvSizeB = 0;
            transportMessagesSendSizeB = 0;
        }
    }, METRIC_SEND_INTERVAL_MS);

    // The script that will be injected into the previewed HTML to handle the other side of the socket connection.
    const LivePreviewTransportRemote = require("text!LiveDevelopment/BrowserScripts/LivePreviewTransportRemote.js");

    // Events - setup the service worker communication channel.
    const BROADCAST_CHANNEL_ID = `${Phoenix.PHOENIX_INSTANCE_ID}_livePreview`;
    let _transportBridge;

    /**
     * Returns the script that should be injected into the browser to handle the other end of the transport.
     * @return {string}
     */
    function getRemoteScript() {
        return "\n" +
            `window.PHOENIX_INSTANCE_ID = "${Phoenix.PHOENIX_INSTANCE_ID}";\n` +
            `window.LIVE_PREVIEW_BROADCAST_CHANNEL_ID = "${BROADCAST_CHANNEL_ID}";\n` +
            `window.LIVE_DEV_REMOTE_WORKER_SCRIPTS_FILE_NAME = "${LiveDevProtocol.LIVE_DEV_REMOTE_WORKER_SCRIPTS_FILE_NAME}";\n` +
            `window.LIVE_PREVIEW_DEBUG_ENABLED = ${logger.loggingOptions.logLivePreview};\n` +
            LivePreviewTransportRemote +
            "\n";
    }

    EventDispatcher.makeEventDispatcher(exports);

    // Exports
    exports.getRemoteScript = getRemoteScript;

    exports.start = function () {
        // Listen to the response
        // attach to browser tab/window closing event so that we send a cleanup request
        // to the service worker for the comm ports
        addEventListener( 'beforeunload', function() {
            _transportBridge && _transportBridge.messageToLivePreviewTabs({
                type: 'PHOENIX_CLOSE'
            });
        });
    };

    exports.close = function () {
        // no-op the broadcast channel is never broken even though live preview may be on or off.
    };

    exports.send = function (clientIDs, message) {
        message = message || "";
        _transportBridge && _transportBridge.messageToLivePreviewTabs({
            type: 'MESSAGE_FROM_PHOENIX',
            clientIDs,
            message
        });
        transportMessagesSendCount ++;
        transportMessagesSendSizeB = transportMessagesSendSizeB + message.length;
    };

    function _browserConnect(_ev, event) {
        window.logger.livePreview.log(
            "Live Preview: Phoenix received event from Browser preview tab/iframe: ", event.data);
        exports.trigger('connect', [event.data.message.clientID, event.data.message.url]);
        transportMessagesRecvCount++;
    }

    function _browserClose(_ev, event) {
        window.logger.livePreview.log(
            "Live Preview: Phoenix received event from Browser preview tab/iframe: ", event.data);
        exports.trigger('close', [event.data.message.clientID]);
        transportMessagesRecvCount++;
    }

    function _browserMessage(_ev, event) {
        window.logger.livePreview.log(
            "Live Preview: Phoenix received event from Browser preview tab/iframe: ", event.data);
        const message = event.data.message.message || "";
        exports.trigger('message', [event.data.message.clientID, message]);
        transportMessagesRecvSizeB = transportMessagesRecvSizeB + message.length;
        transportMessagesRecvCount++;
    }

    function setLivePreviewTransportBridge(transportBridge) {
        _transportBridge = transportBridge;
        transportBridge.off('BROWSER_CONNECT.transport');
        transportBridge.on('BROWSER_CONNECT.transport', _browserConnect);

        transportBridge.off('BROWSER_CLOSE.transport');
        transportBridge.on('BROWSER_CLOSE.transport', _browserClose);

        transportBridge.off('BROWSER_MESSAGE.transport');
        transportBridge.on('BROWSER_MESSAGE.transport', _browserMessage);
    }

    exports.setLivePreviewTransportBridge = setLivePreviewTransportBridge;
    exports.BROADCAST_CHANNEL_ID = BROADCAST_CHANNEL_ID;

});
