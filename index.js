const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

// load environmental variables from .env
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// ---------------------------------------------------------------------------------------------------------------

const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

// ---------------------------------------------------------------------------------------------------------------------

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
let chatCollection;
let feedbackCollection;
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Database
    const db = client.db("SugerSenseDB");
    usersColelction = db.collection("users");
    predictionCollection = db.collection("predictions");
    chatCollection = db.collection("chats");
    feedbackCollection = db.collection("feedback");

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
// prediction psot api
app.post("/api/predict", verifyToken, async (req, res) => {
  try {
    const inputData = req.body;
    const userEmail = req.query.email;
    // console.log(userEmail);

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
// GETAdmin Dashboard Summary

app.get("/api/admin/dashboard", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const totalPredictions = await predictionCollection.countDocuments();

    const diabeticCount = await predictionCollection.countDocuments({
      prediction: "Diabetic",
    });
    const nonDiabeticCount = await predictionCollection.countDocuments({
      prediction: "Non-Diabetic",
    });
    const totalUsers = await usersColelction.countDocuments();
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
    // console.error("Dashboard API Error:", error);
    res.status(500).json({ message: "Error fetching dashboard data", error });
  }
});

app.get("/api/feature-importance", verifyToken, async (req, res) => {
  try {
    const python = spawn("python", ["./python/feature_importance.py"]);

    let output = "";
    python.stdout.on("data", (data) => (output += data.toString()));
    // python.stderr.on("data", (data) =>
    // console.error("Python error:", data.toString())
    // );

    python.on("close", () => {
      try {
        if (!output) throw new Error("Python did not return any output");
        const result = JSON.parse(output);
        res.json({ success: true, data: result });
      } catch (err) {
        res
          .status(500)
          .json({ success: false, error: err.message, rawOutput: output });
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// for export datsets predictions (CSV)
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

// post
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

app.get("/api/users", verifyToken, async (req, res) => {
  try {
    const result = await usersColelction.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

// for check user own data/profile
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

// user management
app.patch("/api/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;
  // console.log(userId);

  if (!["admin", "user"].includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  try {
    const result = await usersColelction.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { role } }
    );
    // console.log(result.modifiedCount);

    if (result.modifiedCount === 1) {
      res.json({ success: true, message: `User role updated to ${role}` });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    // console.error("Update role error:", error);
    res.status(500).json({ success: false, message: "Failed to update role" });
  }
});

//admin check for useAdmin/isAdmin
app.get("/api/users/admin/:email", verifyToken, async (req, res) => {
  try {
    const { email } = req.params;
    const user = await usersColelction.findOne({ email });
    // console.log(user.role)

    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", isAdmin: false });
    }

    res.json({ isAdmin: user.role === "admin" });
  } catch (error) {
    // console.error("Error in /api/users/admin:", error.message);
    res.status(500).json({ message: "Server error", isAdmin: false });
  }
});

//Get all predictions for individuals hstory
app.get("/api/predictions", verifyToken, async (req, res) => {
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

// for delte historry fo prediction
app.delete("/api/predictions/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await predictionCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Prediction not found" });
    }

    res.json({ message: "Prediction deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting prediction", error });
  }
});

// ------------------feadback related APis-------------------

app.post("/api/feedback", verifyToken, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const newFeedback = {
      name,
      email,
      message,
      createdAt: new Date(),
    };
    const result = await feedbackCollection.insertOne(newFeedback);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Error submitting feedback", error });
  }
});

app.get("/api/feedback", async (req, res) => {
  try {
    const email = req.query.email;
    let feedback;

    if (email) {
      feedback = await feedbackCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
    } else {
      feedback = await feedbackCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
    }

    res.json(feedback);
  } catch (error) {
    res.status(500).json({ message: "Error fetching feedback", error });
  }
});

// feedabck delet api--------------------

app.delete("/api/feedback/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const userEmail = req.decoded.email;

    const user = await usersColelction.findOne({ email: userEmail });
    const feedback = await feedbackCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!feedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    if (user?.role === "admin" || feedback.email === userEmail) {
      const result = await feedbackCollection.deleteOne({
        _id: new ObjectId(id),
      });
      return res
        .status(200)
        .json({ message: "Feedback deleted successfully", result });
    } else {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this feedback" });
    }
  } catch (error) {
    console.error("Error deleting feedback:", error);
    res.status(500).json({ message: "Error deleting feedback", error });
  }
});

// =============================================

// --------------------------------------------------------------------------------------------------------------

// Chatbot API---posting context
app.post("/api/chatbot", verifyToken, async (req, res) => {
  const { email } = req.query;
  const { message } = req.body;

  // console.log("User email:", email);
  // console.log("Message:", message);

  if (!email || !message) {
    return res.status(400).json({ message: "Email and message are required" });
  }

  try {
    //fetch last 5 msg for know user context/mind
    const recentChats = await chatCollection
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // for AI prepered it
    const chatHistory = recentChats
      .reverse()
      .map((chat) => [
        { role: "user", content: chat.message },
        { role: "assistant", content: chat.reply },
      ])
      .flat();

    //Send it to OpenAI via OpenRouter
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are SugarSense AI — a friendly, knowledgeable health assistant focused on diabetes awareness and prevention. 
            Always respond in short, clear, and easy-to-understand English. 
            Be empathetic, supportive, and motivational when giving advice.

            Key points:
            - Give practical health and lifestyle tips for preventing and managing diabetes.
            - Encourage healthy habits: balanced diet, regular exercise, and stress control.
            - Avoid medical diagnosis or prescriptions — instead, suggest consulting a doctor.
            - When sharing Bangladeshi health resources, include this verified source:
              https://www.badas.org.bd (Bangladesh Diabetes Association).
            - Keep answers under 5 lines unless the user asks for more details.

          Developer info:
          - Developed by MD. Najmul Islam
          - B.Sc in Computer Science & Engineering (CSE) from Leading University
          - Passionate about health tech and AI applications
          - Entrepreneur and software developer with a focus on practical solutions
            for diabetes awareness and prevention.
          `,
        },
        ...chatHistory,
        { role: "user", content: message },
      ],
    });

    const reply = completion.choices[0].message.content;

    // save coneversation for furhter rembering
    await chatCollection.insertOne({
      email,
      message,
      reply,
      createdAt: new Date(),
    });

    // the final reply for user
    res.json({ success: true, reply });
  } catch (error) {
    // console.error("Chatbot Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "AI response failed",
    });
  }
});

// get chat history-------------------------------------
app.get("/api/chatbot/history", verifyToken, async (req, res) => {
  try {
    const userEmail = req.decoded.email;
    const chats = await chatCollection
      .find({ email: userEmail })
      .sort({ createdAt: 1 }) // old to new
      .toArray();

    res.json({ success: true, data: chats });
  } catch (error) {
    // console.error("Fetch Chat History Error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch chat history" });
  }
});

// ---------------for testing api is correct------------------

// app.get("/test-ai", async (req, res) => {
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "user", content: "Hello AI!" }],
//     });
//     res.json({ success: true, data: response.choices[0].message });
//   } catch (error) {
//     res.json({ success: false, error: error.message });
//   }
// });

// ------------------------------------------------------------------------------------------------------

app.listen(port, () => {
  console.log(`SugerSense-Server running on port ${port}`);
});
