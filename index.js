require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const http = require('http'); 
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io'); 
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 5000;

// 🔥 NEW — create HTTP server
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://chatflow-chat-studio.vercel.app',
      'https://chatflow-chat-studio-git-main-kyachingprue-marmas-projects.vercel.app',
      'https://chatflow-chat-studio-dxd557i5v-kyachingprue-marmas-projects.vercel.app',
    ],
    credentials: true,
  })
);

app.use(cookieParser());

// 🔥 NEW — Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'https://chatflow-chat-studio.vercel.app',
      'https://chatflow-chat-studio-git-main-kyachingprue-marmas-projects.vercel.app',
      'https://chatflow-chat-studio-dxd557i5v-kyachingprue-marmas-projects.vercel.app',
    ],
    credentials: true,
  },
});

// MongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nhw49.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// 🔥 NEW — online users map
const onlineUsers = new Map();

async function run() {
  try {
    // await client.connect();
    // console.log('✅ MongoDB connected');

    const usersCollection = client.db('chatflow-studio').collection('users');
    const friendsCollection = client
      .db('chatflow-studio')
      .collection('friends');
    const messagesCollection = client
      .db('chatflow-studio')
      .collection('messages');
    const friendRequestsCollection = client
      .db('chatflow-studio')
      .collection('friendRequest');

    // 🔥 SOCKET EVENTS
    io.on('connection', socket => {
      socket.on('join', uid => {
        if (!uid) return;

        onlineUsers.set(uid, socket.id);
        io.emit('online-users', Array.from(onlineUsers.keys()));
      });

      socket.on('friend-request', ({ senderUid, receiverUid }) => {
        if (!senderUid || !receiverUid) return;

        const receiverSocketId = onlineUsers.get(receiverUid);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new-friend-request', {
            senderUid,
          });
        }
      });

      socket.on('send-message', async data => {
        const { senderUid, receiverUid, text } = data;
        if (!senderUid || !receiverUid || !text) return;

        const message = {
          senderUid,
          receiverUid,
          text,
          createdAt: new Date(),
        };

        await messagesCollection.insertOne(message);

        const receiverSocketId = onlineUsers.get(receiverUid);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive-message', message);
        }
      });

      socket.on('disconnect', () => {
        for (const [uid, sid] of onlineUsers.entries()) {
          if (sid === socket.id) {
            onlineUsers.delete(uid);
            break;
          }
        }

        io.emit('online-users', Array.from(onlineUsers.keys()));
      });
    });

    //JWT Verify API
    const verifyJWT = (req, res, next) => {
      const token = req.cookies?.token;
      if (!token) return res.status(401).send({ message: 'Unauthorized' });

      jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).send({ message: 'Forbidden' });
        req.decoded = decoded;
        next();
      });
    };

    // CREATE JWT
    app.post('/jwt', (req, res) => {
      const user = req.body;

      const token = jwt.sign(user, process.env.JWT_SECRET_KEY, {
        expiresIn: '1d',
      });

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });

      res.send({ success: true });
    });

    // LOGOUT
    app.post('/logout', (req, res) => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });

      res.send({ success: true });
    });

    // 🔐 CREATE USER
    app.get('/users/:email', verifyJWT, async (req, res) => {
      const { email } = req.params;

      try {
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
      } catch (error) {
        console.error('Get user by email error:', error);
        res.status(500).json({ message: 'Server error' });
      }
    });
    app.post('/users', async (req, res) => {
      try {
        const { uid, name, email, role, isVerified, cover, image } = req.body;

        if (!uid || !email) {
          return res.status(400).json({ message: 'Missing required fields' });
        }

        const existingUser = await usersCollection.findOne({ uid });
        if (existingUser) {
          return res.status(409).json({ message: 'User already exists' });
        }

        const result = await usersCollection.insertOne({
          uid,
          name,
          email,
          image:
            image ||
            'https://i.ibb.co.com/C31ZMR2t/360-F-724597608-pmo5-Bs-Vum-Fc-Fy-HJKl-ASG2-Y2-Kpkkfi-YUU.jpg',
          cover,
          role: role || 'user',
          isVerified: isVerified || false,
          createdAt: new Date(),
        });

        res.status(201).json({
          message: 'User created successfully',
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.patch('/users/verify', async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).json({ message: 'Email required' });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { isVerified: true, verifiedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User verified successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.patch('/users/:email', async (req, res) => {
      const email = decodeURIComponent(req.params.email);
      const updateData = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User updated successfully' });
      } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    // Messages API
    app.get('/messages', verifyJWT, async (req, res) => {
      try {
        const { senderUid, receiverUid } = req.query;

        const messages = await messagesCollection
          .find({
            $or: [
              { senderUid, receiverUid },
              { senderUid: receiverUid, receiverUid: senderUid },
            ],
          })
          .sort({ createdAt: 1 })
          .toArray();

        res.json(messages);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.post('/messages', async (req, res) => {
      try {
        const {
          senderUid,
          receiverUid,
          text,
          senderImage,
          image,
          receiverImage,
        } = req.body;

        if (!senderUid || !receiverUid || (!text && !image)) {
          return res.status(400).json({ message: 'Missing fields' });
        }

        const result = await messagesCollection.insertOne({
          senderUid,
          receiverUid,
          text: text || '',
          image: image || '',
          senderImage,
          receiverImage,
          createdAt: new Date(),
        });

        res
          .status(201)
          .json(
            result.ops ? result.ops[0] : { ...req.body, _id: result.insertedId }
          );
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    //Add Friend API
    app.get('/users/unknown/:uid', verifyJWT, async (req, res) => {
      const { uid } = req.params;
      try {
        const friends = await friendsCollection
          .find({ userUid: uid })
          .toArray();
        const friendUids = friends.map(f => f.friendUid);

        const sentRequests = await friendRequestsCollection
          .find({ senderUid: uid })
          .toArray();
        const receivedRequests = await friendRequestsCollection
          .find({ receiverUid: uid })
          .toArray();

        const requestedUids = [
          ...sentRequests.map(r => r.receiverUid),
          ...receivedRequests.map(r => r.senderUid),
        ];

        const users = await usersCollection
          .find({
            uid: { $nin: [uid, ...friendUids, ...requestedUids] },
          })
          .toArray();

        res.json(users.map(u => ({ ...u, requestSent: false })));
      } catch (err) {
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.post('/friends/request', async (req, res) => {
      const { senderUid, receiverUid } = req.body;

      if (!senderUid || !receiverUid) {
        return res.status(400).json({ message: 'Missing fields' });
      }

      const exists = await friendRequestsCollection.findOne({
        senderUid,
        receiverUid,
        status: 'pending',
      });

      if (exists) {
        return res.status(409).json({ message: 'Request already sent' });
      }

      await friendRequestsCollection.insertOne({
        senderUid,
        receiverUid,
        status: 'pending',
        createdAt: new Date(),
      });

      res.json({ message: 'Request sent' });
    });

    app.delete('/friends/request', verifyJWT, async (req, res) => {
      const { senderUid, receiverUid } = req.body;

      await friendRequestsCollection.deleteOne({
        senderUid,
        receiverUid,
        status: 'pending',
      });

      res.json({ message: 'Request removed' });
    });

    //Friend Request API
    app.get('/friends/requests/:uid', async (req, res) => {
      const { uid } = req.params;

      const requests = await friendRequestsCollection
        .aggregate([
          { $match: { receiverUid: uid, status: 'pending' } },
          {
            $lookup: {
              from: 'users',
              localField: 'senderUid',
              foreignField: 'uid',
              as: 'sender',
            },
          },
          { $unwind: '$sender' },
          {
            $project: {
              senderUid: 1,
              createdAt: 1,
              'sender.name': 1,
              'sender.email': 1,
              'sender.image': 1,
            },
          },
        ])
        .toArray();

      res.json(requests);
    });

    // ✅ SENT FRIEND REQUESTS
    app.get('/friends/requests/sent/:uid', verifyJWT, async (req, res) => {
      const { uid } = req.params;

      try {
        const sentRequests = await friendRequestsCollection
          .aggregate([
            {
              $match: {
                senderUid: uid,
                status: 'pending',
              },
            },
            {
              $lookup: {
                from: 'users',
                localField: 'receiverUid',
                foreignField: 'uid',
                as: 'receiver',
              },
            },
            { $unwind: '$receiver' },
            {
              $project: {
                _id: 0,
                receiverUid: 1,
                createdAt: 1,
                receiver: {
                  name: '$receiver.name',
                  email: '$receiver.email',
                  image: '$receiver.image',
                },
              },
            },
          ])
          .toArray();

        res.json(sentRequests);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.get('/friends/requests/count/:uid', async (req, res) => {
      const { uid } = req.params;

      const count = await friendRequestsCollection.countDocuments({
        receiverUid: uid,
        status: 'pending',
      });

      res.json({ count });
    });
    app.post('/friends/accept', async (req, res) => {
      const { senderUid, receiverUid } = req.body;

      await friendRequestsCollection.deleteOne({
        senderUid,
        receiverUid,
      });

      await friendsCollection.insertMany([
        { userUid: senderUid, friendUid: receiverUid, createdAt: new Date() },
        { userUid: receiverUid, friendUid: senderUid, createdAt: new Date() },
      ]);

      res.json({ message: 'Friend added' });
    });

    // ✅ RECEIVED FRIEND REQUESTS
    app.get('/friends/requests/received/:uid', verifyJWT, async (req, res) => {
      const { uid } = req.params;

      try {
        const receivedRequests = await friendRequestsCollection
          .aggregate([
            {
              $match: {
                receiverUid: uid,
                status: 'pending',
              },
            },
            {
              $lookup: {
                from: 'users',
                localField: 'senderUid',
                foreignField: 'uid',
                as: 'sender',
              },
            },
            { $unwind: '$sender' },
            {
              $project: {
                _id: 0,
                senderUid: 1,
                createdAt: 1,
                sender: {
                  name: '$sender.name',
                  email: '$sender.email',
                  image: '$sender.image',
                },
              },
            },
          ])
          .toArray();

        res.json(receivedRequests);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.post('/friends/reject', verifyJWT, async (req, res) => {
      const { senderUid, receiverUid } = req.body;

      await friendRequestsCollection.deleteOne({
        senderUid,
        receiverUid,
      });

      res.json({ message: 'Request rejected' });
    });

    //My Friends API
    app.get('/friends/:uid', verifyJWT, async (req, res) => {
      const { uid } = req.params;

      try {
        const friends = await friendsCollection
          .aggregate([
            { $match: { userUid: uid } },
            {
              $lookup: {
                from: 'users',
                localField: 'friendUid',
                foreignField: 'uid',
                as: 'friend',
              },
            },
            { $unwind: '$friend' },
            {
              $project: {
                _id: 0,
                uid: '$friend.uid',
                name: '$friend.name',
                email: '$friend.email',
                image: '$friend.image',
              },
            },
          ])
          .toArray();

        res.json(friends);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.delete('/friends', verifyJWT, async (req, res) => {
      const { userUid, friendUid } = req.body;

      if (!userUid || !friendUid) {
        return res.status(400).json({ message: 'Missing fields' });
      }

      try {
        await friendsCollection.deleteMany({
          $or: [
            { userUid, friendUid },
            { userUid: friendUid, friendUid: userUid },
          ],
        });

        res.json({ message: 'Friend removed successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
      }
    });
  } finally {
    // keep connection alive
  }
}

run().catch(console.dir);

// Health check
app.get('/', (req, res) => {
  res.send('Server running 🚀');
});

// 🔥 CHANGED — use server.listen instead of app.listen
server.listen(port, () => {
  console.log(`🚀 Server + Socket.IO running on PORT: ${port}`);
});
