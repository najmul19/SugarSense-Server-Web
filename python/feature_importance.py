import joblib, os, json, sys, traceback

try:
    BASE_DIR = os.path.dirname(__file__)
    model = joblib.load(os.path.join(BASE_DIR, "diabetes_model.pkl"))

    FEATURE_ORDER = [
        "GenHlth", "HighBP", "BMI", "Age", "HighChol", "CholCheck", "Income", "Sex",
        "HeartDiseaseorAttack", "HvyAlcoholConsump", "AnyHealthcare", "DiffWalk",
        "PhysActivity", "Smoker", "Veggies", "Fruits", "Education", "Stroke"
    ]

    lgbm_model = lgbm_model = model.final_estimator_


    importance_df = [
        {"feature": f, "importance": float(i)} 
        for f, i in zip(FEATURE_ORDER, lgbm_model.feature_importances_)
    ]

    print(json.dumps(importance_df))
    sys.stdout.flush()

except Exception as e:
    print(json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc()}))
    sys.stdout.flush()
    sys.exit(1)
