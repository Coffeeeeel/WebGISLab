"use strict";

// olapp.js
// (C) 2015 Minoru Akagi | MIT License
// https://github.com/minorua/WebGISLab

/*
olapp - An OpenLayers application

.core         - Core module.
.core.project - Project management module.
.gui          - GUI module.
.map          - An object of ol.Map. Initialized in olapp.init().
.plugin       - Plugin module.
.project      - An object of olapp.Project. Current project.
.source       - An object. Key is a data source ID and value is a subclass based on olapp.Source.Base.
.tools        - An object. Key is a function/class/group name. Value is a function/class/group. A group is a sub-object.

.init()         - Initialize application.
.loadProject()  - Load a project.

.Project
.Source.Base
*/
var olapp = {
  core: {},
  source: {},
  gui: {},
  plugin: {},
  tools: {}
};


(function () {
  var core = olapp.core,
      gui = olapp.gui,
      plugin = olapp.plugin,
      tools = olapp.tools;

  var map, mapLayers;

  // init()
  olapp.init = function () {
    core.init();
  };

  // loadProject()
  olapp.loadProject = function (project, callback) {
    core.project.load(project, callback);
  };

  // olapp.core
  core.init = function () {
    map = new ol.Map({
      controls: ol.control.defaults({
        attributionOptions: ({
          collapsible: false
        })
      }),
      renderer: ['canvas', 'dom'],    // dom
      target: 'map',
      view: new ol.View({
        projection: 'EPSG:3857',
        center: ol.proj.transform([138.7313889, 35.3622222], 'EPSG:4326', 'EPSG:3857'),
        maxZoom: 18,
        zoom: 5
      })
    });
    olapp.map = map;

    core.project.init();
    gui.init(map);
  };

  core.loadLayerFromFile = function (file) {
    if (!olapp.project) alert('No project');   // TODO: assert

    var ext2formatConstructors = {
      'gpx': [ol.format.GPX],
      'kml': [ol.format.KML],
      'json': [ol.format.GeoJSON, ol.format.TopoJSON]
    };

    var ext = file.name.split('.').pop().toLowerCase();
    var formatConstructors = ext2formatConstructors[ext];
    if (!formatConstructors) formatConstructors = [
      ol.format.GeoJSON,
      ol.format.GPX,
      ol.format.IGC,
      ol.format.KML,
      ol.format.TopoJSON
    ];

    var reader = new FileReader();
    reader.onload = function (event) {
      var layer = core._loadText(reader.result, formatConstructors);

      if (layer) {
        layer.title = file.name;
        olapp.project.addLayer(layer);
        map.getView().fit(layer.getSource().getExtent(), /** @type {ol.Size} */ (map.getSize()));
      }
      else {
        alert('Unknown format file: ' + file.name);
      }
    }
    reader.readAsText(file, 'UTF-8');
  };

  core._loadText = function (text, formatConstructors) {
    var transform = ol.proj.getTransform('EPSG:4326', 'EPSG:3857');

    for (var i = 0; i < formatConstructors.length; i++) {
      var format = new formatConstructors[i]();
      var features = [];
      try {
        features = format.readFeatures(text);
      } catch (e) {
        continue;
      }
      if (features.length == 0) continue;

      features.forEach(function (feature) {
        var geometry = feature.getGeometry();
        if (geometry) geometry.applyTransform(transform);
      });

      var source = new ol.source.Vector({
        features: features
      });

      var layer = new ol.layer.Vector({
        source: source,
        style: core.styleFunction
      });

      return layer;
    }
    return null;
  };

  core.styleFunction = function (feature, resolution) {
    var featureStyleFunction = feature.getStyleFunction();
    if (featureStyleFunction) {
      return featureStyleFunction.call(feature, resolution);
    } else {
      return olapp.defaultStyle[feature.getGeometry().getType()];
    }
  };

  core.urlParams = function () {
    var p, vars = {};
    var params = window.location.search.substring(1).split('&').concat(window.location.hash.substring(1).split('&'));
    params.forEach(function (param) {
      p = param.split('=');
      vars[p[0]] = p[1];
    });
    return vars;
  };


  // olapp.core.project - Project management module
  core.project = {

    init: function () {
      olapp.project = null;
      core.project._lastElemId = -1;
      mapLayers = {};
    },

    addLayer: function (layer) {
      layer.elemId = this.getNextLayerElemId();

      mapLayers[layer.elemId] = layer;
      map.addLayer(layer);
      gui.addLayer(layer);
    },

    addLayers: function (layers) {
      layers.forEach(function (layer) {
        core.project.addLayer(layer);
      });
    },

    clear: function () {
      core.project.init();

      map.getLayers().clear();
      gui.clearLayerList();
    },

    getNextLayerElemId: function () {
      core.project._lastElemId++;
      return 'L' + core.project._lastElemId;
    },

    _loadCallback: null,

    _scriptElement: null,

    // Load a project
    //   prj: olapp.Project object, string (URL), File or Object (JSON).
    //   callback: Callback function. If specified, called when the code to load a project has been executed.
    load: function (prj, callback) {
      if (typeof prj == 'string') {
        // Remove project script element if exists
        var head = document.getElementsByTagName('head')[0];
        if (core.project._scriptElement) head.removeChild(core.project._scriptElement);
        core.project._scriptElement = null;

        var s = document.createElement('script');
        s.type = 'text/javascript';
        s.src = prj;
        head.appendChild(s);
        core.project._scriptElement = s;

        /* Not works with file://
        $('head').append(s);
        $.getScript(prj, function () {
          olapp.gui.status("Have been loaded '" + prj + "'");
        }); */

        // olapp.loadProject() will be called from the project file again.
        core.project._loadCallback = callback;
        return;
      }
      else if (prj instanceof File) {
        var reader = new FileReader();
        reader.onload = function (event) {
          eval(reader.result);
          // TODO: status message
        }
        reader.readAsText(prj, 'UTF-8');
        return;
      }

      // Clear the current project
      core.project.clear();

      // Call this when project has been loaded
      var projectLoaded = function () {
        if (callback) callback();
        else if (core.project._loadCallback) core.project._loadCallback();
        core.project._loadCallback = null;
      };

      if (prj instanceof olapp.Project) {
        olapp.project = prj;

        if (prj.plugins.length > 0) {
          // Load plugins
          plugin.loadPlugins(prj.plugins, function () {
            // Initialize project after plugins are loaded.
            if (prj.init !== undefined) prj.init(prj);
            core.project.addLayers(prj.mapLayers);
            projectLoaded();
          });
          return;
        }

        if (prj.init !== undefined) prj.init(prj);
        core.project.addLayers(prj.mapLayers);

        // TODO: set project title to the gui
      }
      else {
        // TODO: load project in JSON format
      }

      projectLoaded();
    }

  };


  // olapp.gui
  gui.init = function (map) {
    // layer list panel
    $('#slider').slideReveal({
      push: false,
      top: 50,    // TODO: const NAVBAR_HEIGHT = 50;
      trigger: $('#trigger'),
      hidden: function(slider, trigger){
        // Need to remove pushed style manually when the panel is closed with ESC key.
        $('#trigger').removeClass('active');
      }
    });

    // layer list
    $('#layer_list').sortable({
      axis: 'y',
      stop: function (event, ui) {
        gui.updateLayerOrder();
      }
    });

    map.on('pointermove', function (evt) {
      if (evt.dragging) return;
      var pixel = map.getEventPixel(evt.originalEvent);
      gui.displayFeatureInfo(pixel);
    });

    map.on('click', function (evt) {
      gui.displayFeatureInfo(evt.pixel);
    });

    map.getView().on('change:resolution', function (evt) {
      var z = map.getView().getZoom();
      console.log('z: ' + z);
    });

    // Accept file drop
    $(document).on('dragover', function (e) {
      e.preventDefault();
    });

    $(document).on('drop', function (e) {
      e.stopPropagation();
      e.preventDefault();

      var files = e.originalEvent.dataTransfer.files;
      if (files.length == 1 && files[0].name.split('.').pop().toLowerCase() == 'js') {
        core.project.load(files[0]);
      }
      else {
        for (var i = 0; i < files.length; i++) {
          core.loadLayerFromFile(files[i]);
        }
      }
    });

    // search
    $('form[role="search"]').submit(function (event) {
      var q = $('#search').val();
      if (q) tools.geocoding.Nominatim.search(q);
      event.preventDefault();
    });
  };

  // Add a layer to layer list.
  gui.addLayer = function (layer) {
    var checked = (layer.getVisible()) ? ' checked' : '';
    var html = '<div class="list-group-item" id="' + layer.elemId + '">' +
               '  <input type="checkbox"' + checked + '>' + layer.title +
               '  <a href="#" class="btn" style="float:right; padding:2px;" title="Expand/Collapse layer panel">' +
               '    <span class="glyphicon glyphicon-chevron-down"></span>' +
               '  </a>' +
               '</div>';
    var item = $('#layer_list').prepend(html).find('.list-group-item').first();
    item.click(function (event) {
      $('#layer_list .list-group-item.active').removeClass('active');
      $(event.target).addClass('active');
    });
    item.children(':checkbox').change(function () {
      var layer = mapLayers[$(this).parent().attr('id')];
      var visible = $(this).is(':checked');
      layer.setVisible(visible);
    });

    var switchExpansion = function (e) {
      e.stopPropagation();

      var layerId = item.attr('id');
      $('#layer_list .glyphicon-chevron-up').removeClass('glyphicon-chevron-up').addClass('glyphicon-chevron-down');
      $('#layer_list .layer-sub-container').slideUp('fast', function () {
        $(this).remove();
      });

      if ($(this).parent().find('.layer-sub-container').length == 0) {
        $(this).find('span').removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-up');

        var html = '<div class="layer-sub-container">' +
                   '  <div class="layer-button-container">' +
                   '    <button class="btn" title="Zoom to layer extent"><span class="glyphicon glyphicon-zoom-in"></span></button>' +
                   '    <button class="btn" title="Show attribute table"><span class="glyphicon glyphicon-list-alt"></span></button>' +
                   '    <button class="btn" title="Remove layer"><span class="glyphicon glyphicon-trash"></span></button>' +
                   '  </div><div>' +
                   '    <div style="float:left;">' +
                   '      <div class="opacity-slider"></div>' +
                   '    </div><div style="float:right;">' +
                   '      <a href="#" class="btn btn-blendmode" title="Multipy blending mode"><span class="glyphicon glyphicon-tint"></span></a>' +
                   '    </div>' +
                   '  </div>' +
                   '</div>';
        item.append(html);

        if (mapLayers[layerId].blendMode == 'multiply') {
          item.find('.btn-blendmode span').addClass('active');
        }

        item.find('.opacity-slider').slider({
          change: function (event, ui) {
            var opacity = ui.value / 100;
            mapLayers[layerId].setOpacity(opacity);
          },
          slide: function (event, ui) {
            var opacity = ui.value / 100;
            mapLayers[layerId].setOpacity(opacity);
          },
          value: mapLayers[layerId].getOpacity() * 100
        });
        item.find('.layer-sub-container').slideDown('fast');
        item.find('.layer-sub-container').find('.btn-blendmode').click(function (e) {
          e.stopPropagation();

          var blendMode = (mapLayers[layerId].blendMode == 'source-over') ? 'multiply' : 'source-over';
          mapLayers[layerId].blendMode = blendMode;

          var target = $(this);
          if (target.prop('tagName') == 'A') target = target.children();
          if (blendMode == 'multiply') target.addClass('active');
          else target.removeClass('active');

          map.render();
        });
      }
    };
    item.children('.btn').click(switchExpansion);
    item.dblclick(switchExpansion);
  };

  // Remove a layer from layer list.
  gui.removeLayer = function (id) {
    // TODO
  };

  gui.clearLayerList = function () {
    $('#layer_list').html('');
  };

  gui.updateLayerOrder = function () {
    var layers = map.getLayers();
    layers.clear();
    $('#layer_list .list-group-item').each(function (index) {
      var id = $(this).attr('id');
      layers.insertAt(0, mapLayers[id]);
    });
  };

  gui.displayFeatureInfo = function (pixel) {
    var html = '';
    var features = [];
    map.forEachFeatureAtPixel(pixel, function (feature, layer) {
      features.push(feature);
    });
    if (features.length > 0) {
      var info = [];
      var attrs = features[0].values_;
      for (var name in attrs) {
        if (typeof attrs[name] != 'object') html += name + ': ' + attrs[name] + '<br>';
      }
      if (features.length > 1) html += ' and other ' + (features.length - 1) + ' feature(s)';
    }
    $('#info').html(html || '&nbsp;');
  };


  // olapp.plugin
  plugin.plugins = {};
  plugin._loadingPluginSets = [];

  // Add a plugin to the application
  // addPlugin() is called from end of a plugin code, whereas loadPlugin() is called from project/gui.
  plugin.addPlugin = function (pluginPath, module) {
    // Register and initialize the plugin
    plugin.plugins[pluginPath] = module;
    if (module.init !== undefined) module.init();

    // Call callback function
    plugin._loadingPluginSets.forEach(function (pluginSet) {
      var index = pluginSet.plugins.indexOf(pluginPath);
      if (index !== -1) {
        pluginSet.plugins.splice(index, 1);
        if (pluginSet.plugins.length == 0 && pluginSet.callback) pluginSet.callback();
      }
    });

    // Remove completely loaded plugin set from the array
    for (var i = plugin._loadingPluginSets.length - 1; i >= 0; i--) {
      if (plugin._loadingPluginSets[i].plugins.length == 0) plugin._loadingPluginSets.splice(i, 1);
    }
  };

  // Load a plugin
  plugin.loadPlugin = function (pluginPath, callback) {
    plugin.loadPlugins([pluginPath], callback);
  };

  // Load plugins
  // callback is called once when all the plugins have been loaded.
  plugin.loadPlugins = function (pluginPaths, callback) {
    // add scripts
    var head = document.getElementsByTagName('head')[0];
    var loadingPlugins = [];
    pluginPaths.forEach(function (pluginPath) {
      if (pluginPath in plugin.plugins) return;   // already loaded

      var s = document.createElement('script');
      s.type = 'text/javascript';
      s.src = 'plugins/' + pluginPath;
      head.appendChild(s);
      loadingPlugins.push(pluginPath);
    });

    plugin._loadingPluginSets.push({
      plugins: loadingPlugins,
      callback: callback
    });
  };

})();

// TODO: move to below tools
olapp.defaultStyle = {
  'Point': [new ol.style.Style({
    image: new ol.style.Circle({
      fill: new ol.style.Fill({
        color: 'rgba(255,255,0,0.5)'
      }),
      radius: 5,
      stroke: new ol.style.Stroke({
        color: '#ff0',
        width: 1
      })
    })
  })],
  'LineString': [new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: '#f00',
      width: 3
    })
  })],
  'Polygon': [new ol.style.Style({
    fill: new ol.style.Fill({
      color: 'rgba(0,255,255,0.5)'
    }),
    stroke: new ol.style.Stroke({
      color: '#0ff',
      width: 1
    })
  })],
  'MultiPoint': [new ol.style.Style({
    image: new ol.style.Circle({
      fill: new ol.style.Fill({
        color: 'rgba(255,0,255,0.5)'
      }),
      radius: 5,
      stroke: new ol.style.Stroke({
        color: '#f0f',
        width: 1
      })
    })
  })],
  'MultiLineString': [new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: '#0f0',
      width: 3
    })
  })],
  'MultiPolygon': [new ol.style.Style({
    fill: new ol.style.Fill({
      color: 'rgba(0,0,255,0.5)'
    }),
    stroke: new ol.style.Stroke({
      color: '#00f',
      width: 1
    })
  })]
};


// olapp.Project

// Constructor
//   params
//     - options
//       title: Title of project.
//       description: Description of project.
//       plugins: Array of paths of plugins to load.
//       init: function (project). A function to initialize project.
//         - project: project-self.
olapp.Project = function (options) {
  // for (var k in options) { this[k] = options[k]; }
  this.title = options.title || '';
  this.description = options.description || '';
  this.plugins = options.plugins || [];
  this.init = options.init;

  this.mapLayers = [];
};

olapp.Project.prototype = {

  constructor: olapp.Project,

  addLayer: function (layer) {
    if (layer.title === undefined) layer.title = 'no title';
    if (layer.blendMode === undefined) layer.blendMode = 'source-over';

    layer.on('precompose', function (evt) {
      evt.context.globalCompositeOperation = this.blendMode;
    });
    layer.on('postcompose', function (evt) {
      evt.context.globalCompositeOperation = 'source-over';
    });

    this.mapLayers.push(layer);

    // TODO: custom event - Project.layerAdded
    // TODO: add event handler to olapp.core. add the layer to map and gui there.
  },

  removeLayer: function (layer) {
    // TODO
  },

  toJSON: function () {
    // TODO:
  }

};


// olapp.Source
olapp.Source = {};

/*
olapp.Source.Base

.list()             - Get layer list in HTML.
.createLayer(subId) - Create a layer from a sub-source identified by id.
*/
olapp.Source.Base = function () {};

olapp.Source.Base.prototype = {

  constructor: olapp.Source.Base,

  list: function () {},

  createLayer: function (subId) {}

};


// projection
olapp.tools.projection = {};

// Get resolution from general tile zoom level
olapp.tools.projection.resolutionFromZoomLevel = function (zoom) {
  var TILE_SIZE = 256,
      TSIZE1 = 20037508.342789244;
  return TSIZE1 / Math.pow(2, zoom - 1) / TILE_SIZE;
};


// geocoding
olapp.tools.geocoding = {};

// Nominatim
// https://nominatim.openstreetmap.org/
olapp.tools.geocoding.Nominatim = {

  // TODO: search(q, callback)
  search: function (q) {
    var url = 'http://nominatim.openstreetmap.org/search?format=json&json_callback=callback&limit=1&q=' + encodeURIComponent(q);
    $.ajax({
      type: 'GET',
      url: url,
      dataType: 'jsonp',
      jsonpCallback: 'callback',
      success: function(json){
        if (json.length) {
          var dispName = json[0].display_name,
              lon = parseFloat(json[0].lon),
              lat = parseFloat(json[0].lat),
              license = json[0].licence;
          if(confirm('Jump to ' + dispName + ' (' + lon + ', ' + lat + ') ?\n  Search result provided by Nominatim.')) {
            // TODO: callback(lon, lat);
            var target = ol.proj.transform([lon, lat], 'EPSG:4326', 'EPSG:3857');
            olapp.map.getView().setCenter(target);
            olapp.map.getView().setResolution(olapp.tools.projection.resolutionFromZoomLevel(15));
          }
        }
        else {
          alert("No search results for '" + q + "'.");
        }
      }
    });
  }

};


olapp.createDefaultProject = function () {
  return new olapp.Project({
    title: 'Default project',
    description: 'This project is default project, which has GSI tile layers.',
    plugins: ['source/gsitiles.js'],
    init: function (project) {
      var resolutionFromZoomLevel = olapp.tools.projection.resolutionFromZoomLevel;

      // GSI Tiles (source/gsitiles.js)
      var gsitiles = new olapp.source.GSITiles, layer;
      layer = gsitiles.createLayer('std');      // 標準地図
      project.addLayer(layer);

      layer = gsitiles.createLayer('relief');   // 色別標高図
      layer.setVisible(false);
      project.addLayer(layer);

      layer = gsitiles.createLayer('ort');      // 写真
      layer.setVisible(false);
      project.addLayer(layer);
    }
  });
};


// Initialize olapp application
$(function () {
  olapp.init();

  // If project parameter is specified in URL, load the file.
  // Otherwise, load default project.
  var projectName = olapp.core.urlParams()['project'];
  if (projectName) {
    // Check that the project name is safe.
    if (projectName.indexOf('..') !== -1) {
      alert('Specified project name is wrong.');
    }
    else {
      // load the project
      olapp.loadProject('projects/' + projectName + '.js');
    }
  }
  else {
    olapp.loadProject(olapp.createDefaultProject());
  }
});
