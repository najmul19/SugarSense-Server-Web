import sys, json, pandas as pd
import joblib
import os
import traceback
import warnings
warnings.filterwarnings("ignore")

try:
    BASE_DIR = os.path.dirname(__file__)
    model = joblib.load(os.path.join(BASE_DIR, "diabetes_model.pkl"))
    scaler = joblib.load(os.path.join(BASE_DIR, "scaler.pkl"))

    FEATURE_ORDER = [
        "GenHlth", "HighBP", "BMI", "Age", "HighChol", "CholCheck", "Income", "Sex",
        "HeartDiseaseorAttack", "HvyAlcoholConsump", "AnyHealthcare", "DiffWalk",
        "PhysActivity", "Smoker", "Veggies", "Fruits", "Education", "Stroke"
    ]

    #input from Node
    input_data = json.loads(sys.argv[1])
    df = pd.DataFrame([input_data], columns=FEATURE_ORDER)

    #scale & predict
    features_scaled = scaler.transform(df)
    prediction = model.predict(features_scaled)[0]

    print(json.dumps({"prediction": int(prediction)}))

except Exception as e:
    #Json Return
    print(json.dumps({"prediction": None, "error": str(e), "traceback": traceback.format_exc()}))
    sys.exit(1)
