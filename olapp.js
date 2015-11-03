"use strict";

// olapp.js
// (C) 2015 Minoru Akagi | MIT License
// https://github.com/minorua/WebGISLab

/*
olapp - An OpenLayers application

.core        - Core module.
.dataSources - An object. Key is a data source ID and value is a subclass based on olapp.DataSource.Base.
.gui         - GUI module.
.map         - An object of ol.Map. Initialized in olapp.init().
.plugin      - Plugin module.
.project     - Project and layer management module.
.tools       - An object. Key is a function/class/group name. Value is a function/class/group. A group is a sub-object.

.init()      - Initialize application.
*/
var olapp = {
  core: {},
  dataSources: {},
  gui: {},
  plugin: {},
  project: {},
  tools: {}
};


(function () {
  var core = olapp.core,
      project = olapp.project,
      gui = olapp.gui,
      plugin = olapp.plugin,
      tools = olapp.tools;

  var map;

  // init()
  olapp.init = function () {
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

    gui.init(map);
  };


  // olapp.core
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


  // olapp.project

  // Initialize project
  project.init = function () {
    project.mapLayers = {};
    project._lastId = -1;
  };

  project.init();

  project.clear = function () {
    project.init();

    map.getLayers().clear();
    gui.clearLayerList();
  };

  project.addLayer = function (layer) {
    if (layer.id === undefined) layer.id = project.getNextLayerId();
    if (layer.title === undefined) layer.title = 'no title';
    if (layer.blendMode === undefined) layer.blendMode = 'source-over';

    layer.on('precompose', function (evt) {
      evt.context.globalCompositeOperation = this.blendMode;
    });
    layer.on('postcompose', function (evt) {
      evt.context.globalCompositeOperation = 'source-over';
    });

    project.mapLayers[layer.id] = layer;
    map.addLayer(layer);
    gui.addLayer(layer);
  };

  project.removeLayer = function (id) {
    // TODO
  };

  project.getLayerById = function (id) {
    return (project.mapLayers[id] !== undefined) ? project.mapLayers[id] : null;
  };

  project.getNextLayerId = function () {
    project._lastId++;
    return 'L' + project._lastId;
  };

  project.loadLayerFromFile = function (file) {
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
      var layer = project._loadText(reader.result, formatConstructors);

      if (layer) {
        layer.title = file.name;
        project.addLayer(layer);
        map.getView().fit(layer.getSource().getExtent(), /** @type {ol.Size} */ (map.getSize()));
      }
      else {
        alert('Unknown format file: ' + file.name);
      }
    }
    reader.readAsText(file, 'UTF-8');
  };

  project._loadText = function (text, formatConstructors) {
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

  // Load a project
  //   prj: function, string (URL), File or Object (JSON).
  project.load = function (prj) {
    // Clear the current project
    project.clear();

    if (typeof prj == 'function') {
      prj(project);
    }
    else if (typeof prj == 'string') {
      var s = document.createElement('script');
      s.type = 'text/javascript';
      s.src = prj;
      document.getElementsByTagName('head')[0].appendChild(s);
/*
      // Not works with file://
      $('head').append(s);
      $.getScript(project, function () {
        olapp.gui.status("Have been loaded '" + project + "'");
      });
*/
    }
    else if (prj instanceof File) {
      var reader = new FileReader();
      reader.onload = function (event) {
        eval(reader.result);
        // TODO: status message
      }
      reader.readAsText(prj, 'UTF-8');
    }
    else {
      // TODO: load project in JSON format
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
        project.load(files[0]);
      }
      else {
        for (var i = 0; i < files.length; i++) {
          project.loadLayerFromFile(files[i]);
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
    var html = '<div class="list-group-item" id="' + layer.id + '">' +
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
    item.find(':checkbox').change(function () {
      var layer = project.getLayerById($(this).parent().attr('id'));
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

        if (project.mapLayers[layerId].blendMode == 'multiply') {
          item.find('.btn-blendmode span').addClass('active');
        }

        item.find('.opacity-slider').slider({
          change: function (event, ui) {
            var opacity = ui.value / 100;
            project.mapLayers[layerId].setOpacity(opacity);
          },
          slide: function (event, ui) {
            var opacity = ui.value / 100;
            project.mapLayers[layerId].setOpacity(opacity);
          },
          value: project.mapLayers[layerId].getOpacity() * 100
        });
        item.find('.layer-sub-container').slideDown('fast');
        item.find('.layer-sub-container').find('.btn-blendmode').click(function (e) {
          e.stopPropagation();

          var blendMode = (project.mapLayers[layerId].blendMode == 'source-over') ? 'multiply' : 'source-over';
          project.mapLayers[layerId].blendMode = blendMode;

          var target = $(this);
          if (target.prop('tagName') == 'A') target = target.children();
          if (blendMode == 'multiply') target.addClass('active');
          else target.removeClass('active');

          map.render();
        });
      }
    };
    item.find('.btn').click(switchExpansion);
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
      layers.insertAt(0, project.mapLayers[id]);
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
  plugin.loadingPlugins = [];
  plugin.loadingPluginSets = [];

  // Add a plugin to the application (called from end of a plugin code)
  plugin.addPlugin = function (pluginName, module) {
    // register and initialize the plugin
    plugin.plugins[pluginName] = module;
    module.init();

    // call callback function of loadPlugin(s)
    plugin.loadingPlugins.forEach(function () {});
    plugin.loadingPluginSets.forEach(function () {});
  };

  // Load a plugin (called from project/gui)
  plugin.loadPlugin = function (pluginName, callback) {
    // add script

    plugin.loadingPlugins.push({
      plugin: pluginName,
      callback: callback
    });
  };

  // Load plugins
  // callback is called once when all the plugins have been loaded.
  plugin.loadPlugins = function (pluginNames, callback) {
    // add scripts

    plugin.loadingPluginSets.push({
      plugins: pluginNames,
      callback: callback
    });
  };

})();

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


// olapp.DataSource
olapp.DataSource = {};

/*
olapp.DataSource.Base

.list()             - Get layer list in HTML.
.createLayer(subId) - Create a layer from a sub-source identified by id.
*/
olapp.DataSource.Base = function () {};

olapp.DataSource.Base.prototype = {

  constructor: olapp.DataSource.Base,

  list: function () {},

  createLayer: function (subId) {}

};


/*
olapp.DataSource.GSITiles
  inherits from olapp.DataSource.Base
  TODO: move to tiles_jp.js
*/
olapp.DataSource.GSITiles = function () {
  olapp.DataSource.Base.call(this);
};

olapp.DataSource.GSITiles.prototype = Object.create(olapp.DataSource.Base.prototype);
olapp.DataSource.GSITiles.prototype.constructor = olapp.DataSource.Base;

olapp.DataSource.GSITiles.prototype.list = function () {};

olapp.DataSource.GSITiles.prototype.createLayer = function (subId) {};

olapp.dataSources['GSITiles'] = olapp.DataSource.GSITiles;    // register this data source


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


olapp.defaultProject = function (project) {
  var resolutionFromZoomLevel = olapp.tools.projection.resolutionFromZoomLevel;

  // GSI tiles
  // http://maps.gsi.go.jp/development/
  var layer = new ol.layer.Tile({
    source: new ol.source.XYZ({
      attributions: [
        new ol.Attribution({
          html: "<a href='http://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル</a>"
        })
      ],
      projection: 'EPSG:3857',
      tileGrid: ol.tilegrid.createXYZ({
        minZoom: 2,
        maxZoom: 18
      }),
      url: 'http://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
    })
  });
  layer.title = '地理院地図 (標準地図)';
  project.addLayer(layer);

  layer = new ol.layer.Tile({
    source: new ol.source.XYZ({
      attributions: [
        new ol.Attribution({
          html: "<a href='http://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル</a>"
        })
      ],
      projection: 'EPSG:3857',
      tileGrid: ol.tilegrid.createXYZ({
        minZoom: 5,
        maxZoom: 15
      }),
      url: 'http://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png'
    }),
    maxResolution: resolutionFromZoomLevel(5 - 0.1)
  });
  layer.setVisible(false);
  layer.title = '色別標高図';
  project.addLayer(layer);

  layer = new ol.layer.Tile({
    source: new ol.source.XYZ({
      attributions: [
        new ol.Attribution({
          html: "<a href='http://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル</a>"
        })
      ],
      projection: 'EPSG:3857',
      tileGrid: ol.tilegrid.createXYZ({
        minZoom: 2,
        maxZoom: 18
      }),
      url: 'http://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg'
    })
  });
  layer.setVisible(false);
  layer.title = '写真';
  project.addLayer(layer);
};

// Initialize olapp application
$(function () {
  olapp.init();

  // If project parameter is specified in URL, load the file
  // Otherwise, load default project.
  var projectName = olapp.core.urlParams()['project'];
  if (projectName) {
    // Check that the project name is safe.
    if (projectName.indexOf('..') !== -1) {
      alert('Specified project name is wrong.');
    }
    else {
      // load the project
      olapp.project.load('projects/' + projectName + '.js');
    }
  }
  else {
    olapp.project.load(olapp.defaultProject);
  }
});
