# First time setup
The following instructions expect a Bash shell (also includes Git-Bash for Windows).

## 1. Setup python
1. Create python environment: ```python -m venv venv```.
2. Activate python environment: ```source ./venv/*/activate```.

## 2. Setup emscripten
1. Go into ```/vendor/emsdk```.
2. Install specific version of emscripten: ```python ./emsdk.py install 4.0.10```
3. Activate specific version of emscripten: ```python ./emsdk.py activate 4.0.10```
4. Activate emscriptem environment: ```eval $(python ./emsdk.py construct_env)```

## 3. Fix missing typescript compiler
An error such as ```em++: error: tsc executable not found in node_modules or in $PATH``` may occur. This is because emsdk doesn't install typescript from npm by default.

1. Go to upstream/emscripten: ```cd vendor/emsdk/upstream/emscripten```
2. Install typescript: ```npm install typescript```

# Later setup
1. Activate python environment: ```source ./venv/scripts/activate```.
2. Activate emscriptem environment: ```eval $(python ./vendor/emsdk/emsdk.py construct_env)```
3. (Windows) Activate Visual Studio development environment to bring cmake into path.

# Building WASM module
1. Configure cmake: ```emcmake cmake . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release```
2. Build module: ```cmake --build build```
