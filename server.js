var express = require('express'),   
    app = express(),
    server = require('http').createServer(app),
    io = require('socket.io').listen(server),
    conf = require('./config.json'),
    Ayce = require('AyceVR.min.js');

var i = 0, idCount = 0;
var aquariumHeight = 10;
var speedOnScoreFactor = 1.1;
var gameIDCount = 1;

// Websocket
server.listen(conf.port, conf.ip);

io.sockets.on('connection', function (socket) {
    idCount++;
    gameIDCount++;
    var userId = idCount;
    var gameID = gameIDCount;
    for(var i=0; i<5; i++){
        if(Math.random() < 0.5){
            gameID += ""+Math.floor(Math.random()*9);
        }
        else{
            gameID += ""+String.fromCharCode(97+Math.floor(Math.random()*24));
        }
    }
    //Securely remove from pendingGames 
    pendingGames.push(gameID);
    var game = null;
    
    var con = socket.request.connection;
    console.log("User connected: ID:" + userId + " IP: " + con.remoteAddress+":"+con.remotePort + ". GameID " + gameID);
    
    socket.on('join_game', function(data){
        console.log("User " + userId + " joining Game... JoinID "+ data);
        
        if(data === "random"){
            console.log("User #" + userId + ": Joining Random...");
            if(pendingRandom.length > 0){
                game = pendingRandom.shift();
                gameID = game.id;
            }
            else{
                game = new Game(gameID);
                pendingRandom.push(game);
                runningGames.push(game);
            }
        }
        else if(data){
            console.log("User #" + userId + ": Joining with id...");
            var pID = pendingGames.indexOf(data);
            if(pID >= 0){
                pendingGames.splice(pID, 1);
                game = new Game(data);
                runningGames.push(game);
            }
            else{
                for(var i = 0; i < runningGames.length; i++){
                    if(runningGames[i].id == data){
                        game = runningGames[i];
                        gameID = game.id;
                        break;
                    }
                }
            }
        }
        else{
            console.log("User #" + userId + ": Joining...");
            var pID = pendingGames.indexOf(gameID); 
            if(pID >= 0){
                pendingGames.splice(pID, 1);
                game = new Game(gameID);
                runningGames.push(game);
            }
            else{
                for(var i = 0; i < runningGames.length; i++){
                    if(runningGames[i].id == gameID){
                        game = runningGames[i];
                        break;
                    }
                }
            }
        }
        
        
        if(game){
            game.join(userId, socket);
        }
        else{
            console.log("No game to join found. GameID: " + gameID + " JoinID: " + data);
        }
    });
    socket.emit('game_id', gameID);
});

var runningGames = [];
var pendingGames = [];
var pendingRandom = [];
var killGame = function(id){
    for(var i = 0; i < runningGames.length; i++){
        if(runningGames[i].id == id){
            runningGames.splice(i, 1);
            console.log("Game " + id + ": Killed.");
            break;
        }
    }
    console.log(runningGames.length + " running games left.");
};
var Game = function(id){
    var loops = [];
    var totalUsers = 0;
    var lastBallMiss = 0;
    var o3Ds = [];
    var score1 = 0, score2 = 0;
    var playersConnected = false;
    var roundActive = false;
    var firstReady = true;
    var readyTime;
    var readyCount = 0;
    var countIn = 5;
    var maxPoints = 5;
    var poolVec = new Ayce.Vector3();
    var scope = this;
    scope.id = id;
    scope.players = [];
    scope.spectators = [];
    scope.join = function(userId, socket){
        totalUsers++;
        var user = {};

        user.id = userId;
        user.socket = socket;
        user.position = new Ayce.Vector3(0, aquariumHeight, 0);
        user.rotation = new Ayce.Quaternion();
        user.ready = false;
        user.playerType= null;
        user.getGlobalRotation = function(){return this.rotation;};
        user.getGlobalPosition = function(){return this.position;};

        user.socket.on('error', function (err) {
            console.log("Game "+id + ": " + err);
        });

        if(scope.players[0] == undefined || scope.players[1] == undefined) {
            var playerNo;
            if (scope.players.length == 0) {    // PLAYER1
                playerNo = 0;
            }else {                             //PLAYER2
                playerNo = 1;
            }

            user.playerType = "player"+(playerNo+1);
            if(playerNo==0){
                user.position.z = -17;
                user.rotation.fromEulerAngles(0, Math.PI, 0);
            }else{
                user.position.z = 17;
            }

            user.socket.on('player_ready', function (data) {
                if(!scope.players[playerNo].ready){
                    console.log("player " + scope.players[playerNo].id + " ready.");
                    scope.players[playerNo].ready = data.ready;
                    emitToEveryone('ready_up', {type: scope.players[playerNo].playerType});
                }
            });
            user.socket.on('camera_pos', function(data){
                scope.players[playerNo].position.x = data.position.x;
                scope.players[playerNo].position.y = data.position.y;
                scope.players[playerNo].position.z = data.position.z;

                scope.players[playerNo].rotation.x = data.orientation.x;
                scope.players[playerNo].rotation.y = data.orientation.y;
                scope.players[playerNo].rotation.z = data.orientation.z;
                scope.players[playerNo].rotation.w = data.orientation.w;
            });
            panes[playerNo].active = true;
            panes[playerNo].empty.parent = user;
            panes[playerNo].clientID = user.id;

            user.socket.on('disconnect', function(){
                emitToEveryone('remove_player', { id: scope.players[playerNo].id});
                onPlayerExit(scope.players[playerNo].id);
                console.log("Game " + id + ": Player"+(playerNo+1)+" (ID#"+scope.players[playerNo].id+") left.");
                scope.players[playerNo] = undefined;
                totalUsers--;
                killEmptyGame();
            });
            scope.players[playerNo] = user;

            console.log("Game " + id + ": Player"+(playerNo+1)+" (ID#"+scope.players[playerNo].id+") joined.");

            user.socket.emit('id', {id: user.id, type: user.playerType});
        }else {
            user.playerType = "spectator";
            user.position.x = 15;
            user.rotation.fromEulerAngles(0, -Math.PI/2.0, 0);
            var spectatorIndex = scope.spectators.length;
            user.socket.on('camera_pos', function(data){
                scope.spectators[spectatorIndex].position.x = data.position.x;
                scope.spectators[spectatorIndex].position.y = data.position.y;
                scope.spectators[spectatorIndex].position.z = data.position.z;

                scope.spectators[spectatorIndex].rotation.x = data.orientation.x;
                scope.spectators[spectatorIndex].rotation.y = data.orientation.y;
                scope.spectators[spectatorIndex].rotation.z = data.orientation.z;
                scope.spectators[spectatorIndex].rotation.w = data.orientation.w;
            });
            user.socket.on('disconnect', function(data){
                console.log("Game " + id + ": Spectator (ID#"+scope.spectators[spectatorIndex].id+") left.");
                emitToEveryone('remove_player', { id: scope.spectators[spectatorIndex].id});
                console.log("spectatorIndex " + spectatorIndex);
                scope.spectators[spectatorIndex] = undefined;
                totalUsers--;
                killEmptyGame();
            });
            scope.spectators.push(user);
            console.log("Game " + id + ": Spectator (ID#"+scope.spectators[scope.spectators.length-1].id+") joined.");
        }
        user.socket.emit('change_positon', {position: user.position, rotation: user.rotation});

        sendO3D_Client("sphere", "ball", {position: ball.position, velocity: ball.velocity}, user.socket);
        sendO3D_Client("pane", "paneP1", {position: panes[0].position}, user.socket);
        sendO3D_Client("pane", "paneP2", {position: panes[1].position}, user.socket);
    };

    var frontWall, backWall, topWall, bottomWall,
        leftWall, rightWall, ball, ballCollision;

    var panes = [
        {
            active: false,
            clientID: undefined,
            player: 1,
            pane: new Ayce.Cube3D(),
            empty: new Ayce.Object3D()
        },
        {
            active: false,
            clientID: undefined,
            player: 2,
            pane: new Ayce.Cube3D(),
            empty: new Ayce.Object3D()
        }
    ];

    var init = function(){
        console.log("Initializing...");

        frontWall = new Ayce.Geometry.Box(6, 5, 0.5);
        frontWall.offset.set(-frontWall.a/2.0, -frontWall.b/2.0, -frontWall.c);
        frontWall = frontWall.getO3D();

        backWall = new Ayce.Geometry.Box(6, 5, 0.5);
        backWall.offset.set(-backWall.a/2.0, -backWall.b/2.0, 0);
        backWall = backWall.getO3D();

        topWall = new Ayce.Geometry.Box(6, 0.5, 40);
        topWall.offset.set(-topWall.a/2.0, 0, -topWall.c/2.0);
        topWall = topWall.getO3D();

        bottomWall = new Ayce.Geometry.Box(6, 0.5, 40);
        bottomWall.offset.set(-bottomWall.a/2.0, -bottomWall.b, -bottomWall.c/2.0);
        bottomWall = bottomWall.getO3D();

        leftWall = new Ayce.Geometry.Box(0.5, 5, 40);
        leftWall.offset.set(-leftWall.a, -leftWall.b/2.0, -leftWall.c/2.0);
        leftWall = leftWall.getO3D();

        rightWall = new Ayce.Geometry.Box(0.5, 5, 40);
        rightWall.offset.set(0, -rightWall.b/2.0, -rightWall.c/2.0);
        rightWall = rightWall.getO3D();

        ball = new Ayce.Geometry.Sphere(0.2).getO3D();
        ballCollision = [frontWall, backWall, topWall, bottomWall, leftWall, rightWall];

        frontWall.position.set(0, aquariumHeight, -20);
        backWall.position.set(0, aquariumHeight, 20);
        topWall.position.set(0, 2.5+aquariumHeight, 0);
        bottomWall.position.set(0, -2.5+aquariumHeight, 0);
        leftWall.position.set(-3, aquariumHeight, 0);
        rightWall.position.set(3, aquariumHeight, 0);

        var paneScale = new Ayce.Vector3(1.25, 1, 0.1);

        panes[0].empty.position = new Ayce.Vector3(0, 0, -4);
        panes[0].pane.scale = paneScale;
        panes[0].pane.calcBoundingBox();
        panes[0].pane.calcBoundingSphere();

        panes[1].empty.position = new Ayce.Vector3(0, 0, -4);
        panes[1].pane.scale = paneScale;
        panes[1].pane.calcBoundingBox();
        panes[1].pane.calcBoundingSphere();

        ballCollision.push(panes[0].pane, panes[1].pane);
        o3Ds.push(panes[0].pane, panes[1].pane);

        ball.position.set(0, aquariumHeight, 0);
        ball.velocity.set(0, 0, 0);
        ball.collision = true;
        ball.collideWith = ballCollision;
        ball.onCollision = function(collisionData){
            var sendData = {};
            sendData.id = "ball";
            sendData.position = ball.position;
            emitToEveryone('collision', sendData);

            if(collisionData.collisionWith === frontWall){
                ball.position.set(0, aquariumHeight, 0);
                ball.velocity.z *= speedOnScoreFactor;
                addScore(0);
                lastBallMiss = Date.now();
            }
            else if(collisionData.collisionWith === backWall){
                ball.position.set(0, aquariumHeight, 0);
                ball.velocity.z *= speedOnScoreFactor;
                addScore(1);
                lastBallMiss = Date.now();
            }

            var normal = collisionData.collisionVector.normal.copy();
            normal.scaleBy(-2*normal.dotProduct(ball.velocity));
            ball.velocity = ball.velocity.addVector3(normal);
        };

        addO3D(frontWall, backWall, leftWall, rightWall, bottomWall, leftWall, topWall, ball);
    };

    // TODO: Bug: Two players join, one is ready. Player that is ready leaves. Other Player still sees that player as ready.

    var update = function(){
        loops[0] = setTimeout(update, 16);

        if(panes[0].active)updatePane(panes[0]);
        if(panes[1].active)updatePane(panes[1]);

        if(scope.players[0] != undefined && scope.players[1] != undefined){
            if(!playersConnected){
                onPlayersConnected();
                playersConnected = true;
            }
        }else if(playersConnected){
            onPlayerDisconnected();
            if(roundActive){
                onRoundAbort();
                roundActive = false;
            }
            playersConnected = false;
        }

        if(playersConnected){
            var c1 = scope.players[0];
            var c2 = scope.players[1];

            if(c1.ready && c2.ready){
                if(!roundActive){
                    onPlayersReady();
                }else{
                    onRoundFinished();
                }
            }
        }

        for(i=0; i<o3Ds.length; i++){
            o3Ds[i].update();
        }
    };

    var sendO3Ds = [];

    var send = function(){
        loops[1] = setTimeout(send, 100);

        sendO3Ds.length = 0;
        sendO3Ds.push({ id: 'ball', position: ball.position, rotation: ball.rotation, velocity: ball.velocity});
        sendO3Ds.push({ id: 'paneP1', position: panes[0].pane.position, rotation: panes[0].pane.rotation});
        sendO3Ds.push({ id: 'paneP2', position: panes[1].pane.position, rotation: panes[1].pane.rotation});

        emitToEveryone('update_O3D', sendO3Ds);
        emitToEveryone('player_pos', getPlayersPacket());
    };


    // helpers

    var emitToEveryone = function(key, message){
        for(var i = 0; i < scope.players.length; i++){
            if(scope.players[i] != undefined) scope.players[i].socket.emit(key, message);
        }
        for(i = 0; i < scope.spectators.length; i++){
            if(scope.spectators[i] != undefined) scope.spectators[i].socket.emit(key, message);
        }
    };

    var addScore = function(player){
        if(player === 0)score1 = (score1+1)%100;
        else if(player === 1)score2 = (score2+1)%100;
        emitToEveryone('score', {score1:score1, score2:score2});
    };

    var sendO3D_Client = function(type, id, args, pushToContainer, socket){
        var o = {
            type: type,
            id: id,
            args: args
        };
        if(socket){
            socket.emit('add_O3D', o);
        }else{
            emitToEveryone('add_O3D', o);
        }
    };

    var addO3D = function(){
        for(var o3D in arguments){
            arguments[o3D].calcBoundingBox();
            arguments[o3D].calcBoundingSphere();
            o3Ds.push(arguments[o3D]);
        }
    };

    var updatePane = function(paneObj){
        poolVec.set(0, 0, -1);


        var empty = paneObj.empty;
        empty.update();
        empty.rotation = empty.parent.rotation.getConjugate();
        empty.rotation.normalize();
        empty.rotation.rotatePoint(poolVec);

        var pane = paneObj.pane;
        pane.position = empty.getGlobalPosition();
        pane.rotation = empty.getGlobalRotation();

        var aqWidth = 3;
        var aqHeight = 2.5;
        if(pane.position.x > aqWidth-(pane.scale.x/2.0))pane.position.x = aqWidth-(pane.scale.x/2.0);
        else if(pane.position.x < -aqWidth+(pane.scale.x/2.0))pane.position.x = -aqWidth+(pane.scale.x/2.0);

        if(pane.position.y > aquariumHeight+aqHeight-(pane.scale.y/2.0))pane.position.y = aquariumHeight+aqHeight-(pane.scale.y/2.0);
        else if(pane.position.y < aquariumHeight-aqHeight+(pane.scale.y/2.0))pane.position.y = aquariumHeight-aqHeight+(pane.scale.y/2.0);

        if(empty.getGlobalPosition().z < 0){
            pane.position.z = -17;
            pane.position.z -= poolVec.z < 0 ? 2.5 : -4;
        }
        else{
            pane.position.z =  17;
            pane.position.z -= poolVec.z < 0 ? 4 : -2.5;
        }
    };

    var onPlayersConnected = function(){
        //console.log("Players connected.");
    };

    var onPlayerDisconnected = function(){
        //console.log("Player disconnected.");
        firstReady = true;
    };
    var onRoundAbort = function(){
        console.log("Round end.");
        roundActive = false;
        ball.position.set(0, aquariumHeight, 0);
        ball.velocity.set(0, 0, 0);
    };
    var onPlayersReady = function(){
        if(firstReady){
            console.log("Players are ready.");
            readyCount = 0;
            readyTime = Date.now();
            firstReady = false;
            emitToEveryone('countdown', {time: readyTime});
        }
        var duration = Date.now() - readyTime;

        if(duration/1000.0 > readyCount){
            console.log(countIn-readyCount);
            readyCount++;
            if(readyCount > countIn){
                onRoundStart();
                roundActive = true;
                firstReady = true;
            }
        }
    };
    var onPlayerExit = function(type){
        if(type == "player1"){
            scope.players[0] = undefined;
            panes[0].active = false;
        }
        else if(type == "player2"){
            scope.players[1] = undefined;
            panes[1].active = false;
        }
    };
    var onRoundFinished = function(){
        if(score1 >= maxPoints || score2 >= maxPoints){
            console.log("Max points.");
            onRoundAbort();
            scope.players[0].ready = false;
            scope.players[1].ready = false;
        }
    };
    var getPlayersPacket = function(){
        var packet = [];
        for(i = 0; i < scope.players.length; i++) {
            if (scope.players[i] && scope.players[i].position && scope.players[i].rotation) {
                packet.push({
                    id: scope.players[i].id,
                    position: scope.players[i].position,
                    rotation: scope.players[i].rotation
                });
            }
        }
        for(i = 0; i < scope.spectators.length; i++) {
            if (scope.spectators[i] && scope.spectators[i].position && scope.spectators[i].rotation) {
                packet.push({
                    id: scope.spectators[i].id,
                    position: scope.spectators[i].position,
                    rotation: scope.spectators[i].rotation
                });
            }
        }
        return packet;
    };

    var onRoundStart = function(){
        console.log("Round start.");
        resetScore();
        ball.position.set(0, aquariumHeight, 0);
        ball.velocity.set(1 + 0.5*Math.random(), -2 + 4*Math.random(), 5);
        lastBallMiss = Date.now();
    };

    var resetScore = function(){
        score1 = 0;
        score2 = 0;
        emitToEveryone('score', {score1:score1, score2:score2});
    };

    var killEmptyGame = function(){
        if(totalUsers <= 0){
            clearTimeout(loops[0]);
            clearTimeout(loops[1]);
            killGame(id);
        }
    };

    init();
    update();
    send();
};