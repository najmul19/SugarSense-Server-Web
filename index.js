const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// load environmental variables from .env
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
// middleware
app.use(cors());
app.use(express.json());

//mongoDB connection setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zof5niq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
let predictionCollection;
let usersColelction;
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // Database
    const db = client.db("SugerSenseDB");
    usersColelction = db.collection("users");
    predictionCollection = db.collection("predictions");

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// ------------------------- Auth helpers -------------------------

// Create JWT
// function createToken(payload) {
//   const secret = process.env.JWT_SECRET;
//   const expiresIn = process.env.JWT_EXPIRES_IN || "1h";
//   return jwt.sign(payload, secret, { expiresIn });
// }

// jwt related apis
app.post("/api/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.send({ token });
});

// Custom Middleware for Authorization
const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized Access!" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

// use veryfy admin after veryfy token
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const query = { email: email };
  const user = await usersColelction.findOne(query);

  const isAdmin = user?.role === "admin";
  if (!isAdmin) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

// =====================================================================

// root route
app.get("/", (req, res) => {
  res.send(" SugerSense-Server is running ");
});

// custom route

app.post("/api/predict", verifyToken, async (req, res) => {
  try {
    const inputData = req.body;
    const userEmail = req.query.email;
    console.log(userEmail);

    const python = spawn("python", [
      "./python/predictor.py",
      JSON.stringify(inputData),
    ]);

    let predictionResult = "";

    python.stdout.on("data", (data) => {
      predictionResult += data.toString();
    });

    python.stderr.on("data", (data) => {
      console.error(`Python error: ${data}`);
    });

    python.on("close", async (code) => {
      try {
        const result = JSON.parse(predictionResult);
        const prediction =
          result.prediction === 1 ? "Diabetic" : "Non-Diabetic";

        if (!predictionCollection) {
          return res
            .status(500)
            .json({ success: false, error: "Database not initialized" });
        }

        const record = {
          ...inputData,
          prediction,
          email: userEmail,
          createdAt: new Date(),
        };

        await predictionCollection.insertOne(record);

        res.json({
          success: true,
          message: "Prediction successful",
          data: record,
        });
      } catch (error) {
        console.error("Error parsing Python result:", error);
        res
          .status(500)
          .json({ success: false, error: "Failed to process prediction" });
      }
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ----------------------------------------------------
// GET: Admin Dashboard Summary
app.get("/api/admin/dashboard", async (req, res) => {
  try {
    const totalPredictions = await predictionCollection.countDocuments();

    // Count diabetic vs non-diabetic
    const diabeticCount = await predictionCollection.countDocuments({
      prediction: "Diabetic",
    });
    const nonDiabeticCount = await predictionCollection.countDocuments({
      prediction: "Non-Diabetic",
    });

    // If you store users in Mongo, include this:
    // const totalUsers = await userCollection.countDocuments();
    // Otherwise, mock it for now:
    const totalUsers = 10;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalPredictions,
        diabeticCount,
        nonDiabeticCount,
      },
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    res
      .status(500)
      .json({ message: "Error fetching dashboard data", error });
  }
});


app.get(
  "/api/admin/predictions",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const allPredictions = await predictionCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(allPredictions);
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
  }
);
// ==============================================================================
// user related api
app.post("/api/users", async (req, res) => {
  const user = req.body;
  const newUser = {
    ...user,
    role: "user",
    createdAt: new Date().toISOString(),
  };
  const query = { email: user.email };
  const existingUser = await usersColelction.findOne(query);
  if (existingUser) {
    return res.send({ message: "user already exist", insertedId: null });
  }
  const result = await usersColelction.insertOne(newUser);
  res.send(result);
});

app.get("/api/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await usersColelction.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

app.get("/api/users/:email", verifyToken, async (req, res) => {
  const email = req.params.email;
  try {
    const user = await usersColelction.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }
    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch user" });
  }
});

//Get all predictions
app.get("/api/predictions", async (req, res) => {
  try {
    const email = req.query.email;
    let predictions;

    if (email) {
      predictions = await predictionCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
    } else {
      predictions = await predictionCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
    }

    res.json(predictions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching predictions", error });
  }
});

// =============================================

app.listen(port, () => {
  console.log(`SugerSense-Server running on port ${port}`);
});
