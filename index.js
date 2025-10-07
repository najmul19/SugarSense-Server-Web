const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { spawn } = require("child_process");

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

// root route
app.get("/", (req, res) => {
  res.send(" SugerSense-Server is running ");
});

// custom route

app.post("/api/predict", async (req, res) => {
  try {
    const inputData = req.body; //feature

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

app.get("/api/admin/predictions", async (req, res) => {
  try {
    const allPredictions = await predictionCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.json(allPredictions);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch data" });
  }
});
// ==============================================================================
// user related api
app.post("/api/users", async (req, res) => {
  const user = req.body;
  const newUser = {
    ...user,
    role: "user",
  };
  const result = await usersColelction.insertOne(newUser);
  res.status(201).send(result);
});

app.get("/api/users", async (req, res) => {
  try {
    const result = await usersColelction.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch users" });
  }
});


app.get("/api/users/:email", async (req, res) => {
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


// =============================================

app.listen(port, () => {
  console.log(`SugerSense-Server running on port ${port}`);
});
