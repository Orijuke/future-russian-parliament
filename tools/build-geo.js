const fs=require("fs"),d3=require("d3-geo"),ts=require("topojson-server"),tc=require("topojson-client"),tsimp=require("topojson-simplify");
const g=JSON.parse(fs.readFileSync("raw/ne1.geojson"));
const csv=fs.readFileSync(process.argv[2],"utf8");
const map={1:"RU-BEL",2:"RU-BRY",3:"RU-VLA",4:"RU-VOR",5:"RU-IVA",6:"RU-KLU",7:"RU-KOS",8:"RU-KRS",9:"RU-LIP",10:"RU-MOS",11:"RU-MOW",12:"RU-ORL",13:"RU-RYA",14:"RU-SMO",15:"RU-TAM",16:"RU-TVE",17:"RU-TUL",18:"RU-YAR",19:"RU-SPE",20:"RU-LEN",21:"RU-KR",22:"RU-KO",23:"RU-ARK",24:"RU-NEN",25:"RU-VLG",26:"RU-KGD",27:"RU-MUR",28:"RU-NGR",29:"RU-PSK",30:"RU-AD",31:"RU-KL",32:"UA-43",33:"RU-KDA",34:"RU-AST",35:"RU-VGG",36:"RU-ROS",37:"UA-40",38:"RU-DA",39:"RU-IN",40:"RU-KB",41:"RU-KC",42:"RU-SE",43:"RU-CE",44:"RU-STA",45:"RU-BA",46:"RU-ME",47:"RU-MO",48:"RU-TA",49:"RU-UD",50:"RU-CU",51:"RU-PER",52:"RU-KIR",53:"RU-NIZ",54:"RU-ORE",55:"RU-PNZ",56:"RU-SAM",57:"RU-SAR",58:"RU-ULY",59:"RU-KGN",60:"RU-SVE",61:"RU-TYU",62:"RU-KHM",63:"RU-YAN",64:"RU-CHE",65:"RU-AL",66:"RU-TY",67:"RU-KK",68:"RU-ALT",69:"RU-KYA",70:"RU-IRK",71:"RU-KEM",72:"RU-NVS",73:"RU-OMS",74:"RU-TOM",75:"RU-BU",76:"RU-SA",77:"RU-ZAB",78:"RU-KAM",79:"RU-PRI",80:"RU-KHA",81:"RU-AMU",82:"RU-MAG",83:"RU-SAK",84:"RU-YEV",85:"RU-CHU",
86:"UA-14",87:"UA-09",88:"UA-23",89:"UA-65"};
const rows=csv.trim().split(/\r?\n/).slice(1).map(l=>{const m=l.match(/("([^"]*)"|[^,]*)(,|$)/g).map(s=>s.replace(/,$/,"").replace(/^"|"$/g,""));return m});
const meta={};
for(const r of rows){meta[+r[0]]={name:r[1],fo:r[2],group:(r[0]==32||r[0]==37)?"crimea":"core"};}
Object.assign(meta,{86:{name:"Донецкая Народная Республика",fo:"ЮФО",group:"new"},87:{name:"Луганская Народная Республика",fo:"ЮФО",group:"new"},88:{name:"Запорожская область",fo:"ЮФО",group:"new"},89:{name:"Херсонская область",fo:"ЮФО",group:"new"}});
const byIso={};for(const f of g.features)byIso[f.properties.iso_3166_2]=f;
const feats=[];
for(const id in map){const f=byIso[map[id]];if(!f)throw id;let geom=f.geometry;const pa=c=>{const a=d3.geoArea({type:"Polygon",coordinates:c});return Math.min(a,4*Math.PI-a)};const th=250/(6371*6371);if(geom.type==="MultiPolygon"){const ps=geom.coordinates.filter(p=>pa(p)>th);geom={type:"MultiPolygon",coordinates:ps.length?ps:geom.coordinates};}const sh=c=>typeof c[0]==="number"?[c[0]<0?c[0]+360:c[0],c[1]]:c.map(sh);geom={type:geom.type,coordinates:sh(geom.coordinates)};feats.push({type:"Feature",id:+id,properties:{},geometry:geom});}
let topo=ts.topology({r:{type:"FeatureCollection",features:feats}});
topo=tsimp.presimplify(topo);
const minW=tsimp.quantile(topo,0.12);
topo=tsimp.simplify(topo,minW);
const fc={type:"FeatureCollection",features:topo.objects.r.geometries.map(gm=>({type:"Feature",id:gm.id,properties:{},geometry:tc.merge(topo,[gm])}))};
const proj=d3.geoConicEqualArea().rotate([-100,0]).parallels([52,64]).fitExtent([[8,8],[1192,692]],fc);
const W=1200,H=700;
const path=d3.geoPath(proj).digits(1);
const out={W,H,regions:[]};
for(const f of fc.features){const m=meta[f.id];const c=path.centroid(f);const b=path.bounds(f);
  out.regions.push({id:f.id,name:m.name,fo:m.fo,group:m.group,d:path(f),c:c.map(v=>+v.toFixed(1)),b:b.flat().map(v=>+v.toFixed(1))});}
// FO borders & outline per visibility state: compute meshes by group combos
const geoms=topo.objects.r.geometries;
const fo=id=>meta[id].fo, grp=id=>meta[id].group;
out.meshes={};
// fo borders between two visible regions of different FO, always same; store per pair-group to toggle
const mk=(filt)=>path(tc.mesh(topo,topo.objects.r,filt));
out.meshes.fo=mk((a,b)=>a!==b&&fo(a.id)!==fo(b.id)&&grp(a.id)==="core"&&grp(b.id)==="core");
out.meshes.foCrimea=mk((a,b)=>a!==b&&fo(a.id)!==fo(b.id)&&(grp(a.id)==="crimea"||grp(b.id)==="crimea"));
out.meshes.foNew=mk((a,b)=>a!==b&&fo(a.id)!==fo(b.id)&&(grp(a.id)==="new"||grp(b.id)==="new")&&grp(a.id)!=="crimea"&&grp(b.id)!=="crimea");
fs.writeFileSync("geo.json",JSON.stringify(out));
console.log("bytes",fs.statSync("geo.json").size, out.regions.length);
// emit width/height check
const [[x0,y0],[x1,y1]]=path.bounds(fc);console.log(x0,y0,x1,y1);
