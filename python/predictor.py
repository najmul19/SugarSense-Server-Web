import sys
import json

import sys
import json
import numpy as np
import joblib

# Load trained model
model = joblib.load("python/diabetes_model.pkl") 

# Receive input data from Node.js
input_json = sys.argv[1]
data = json.loads(input_json)

# Convert input to numpy array
features = np.array([list(data.values())]).astype(float)

# Make prediction
prediction = model.predict(features)[0]

# Send result back to Node.js
output = {"prediction": "Diabetic" if prediction == 1 else "Non-Diabetic"}
print(json.dumps(output))

